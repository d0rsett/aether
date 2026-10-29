use aether_core::{attachments, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::{sync::mpsc, time::Duration};
use tauri::Url;

const IMAGE_LIMIT: usize = 8 * 1024 * 1024;
const MEDIA_LIMIT: usize = 64 * 1024 * 1024;
const MAX_REDIRECTS: usize = 4;
static DNS_PENDING: AtomicUsize = AtomicUsize::new(0);

fn bad_url() -> Error {
    Error::InvalidPath(
        "Для загрузки доступен только публичный HTTP(S)-адрес без учётных данных.".into(),
    )
}
fn public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113))
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_ipv4(ip),
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only ordinary global unicast; reject transition/tunnel and documentation ranges.
            s[0] & 0xe000 == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
        }
    }
}
fn parse_url(raw: &str) -> Result<Url> {
    if raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err(bad_url());
    }
    let parsed = Url::parse(raw).map_err(|_| bad_url())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(bad_url());
    }
    Ok(parsed)
}
fn resolve(url: &Url) -> Result<SocketAddr> {
    let host = url
        .host_str()
        .ok_or_else(bad_url)?
        .trim_matches(['[', ']'])
        .to_owned();
    let port = url.port_or_known_default().ok_or_else(bad_url)?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        return if public_ip(ip) {
            Ok(SocketAddr::new(ip, port))
        } else {
            Err(bad_url())
        };
    }
    if DNS_PENDING
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            (value < 8).then_some(value + 1)
        })
        .is_err()
    {
        return Err(Error::Io(
            "Слишком много одновременных запросов к серверам.".into(),
        ));
    }
    let (send, receive) = mpsc::sync_channel(1);
    let worker = std::thread::Builder::new()
        .name("aether-external-dns".into())
        .spawn(move || {
            let result = (host.as_str(), port)
                .to_socket_addrs()
                .map(|mut addresses| addresses.find(|address| public_ip(address.ip())));
            DNS_PENDING.fetch_sub(1, Ordering::Relaxed);
            let _ = send.send(result);
        });
    if worker.is_err() {
        DNS_PENDING.fetch_sub(1, Ordering::Relaxed);
        return Err(Error::Io("Не удалось проверить адрес сервера.".into()));
    }
    receive
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| Error::Io("Не удалось найти сервер вложения вовремя.".into()))?
        .map_err(|_| Error::Io("Не удалось найти сервер вложения.".into()))?
        .ok_or_else(bad_url)
}
fn media_mime(kind: &str, bytes: &[u8]) -> Result<&'static str> {
    let iso = bytes.get(4..8) == Some(b"ftyp");
    let ogg = bytes.starts_with(b"OggS");
    let ebml = bytes.starts_with(b"\x1a\x45\xdf\xa3");
    match kind {
        "image" => match attachments::image_mime(bytes)? {
            "image/png" => Ok("image/png"),
            "image/jpeg" => Ok("image/jpeg"),
            "image/gif" => Ok("image/gif"),
            "image/webp" => Ok("image/webp"),
            "image/bmp" => Ok("image/bmp"),
            _ => Err(Error::Io(
                "Этот формат внешнего изображения не поддерживается.".into(),
            )),
        },
        "pdf" if bytes.starts_with(b"%PDF-") => Ok("application/pdf"),
        "audio" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE") => {
            Ok("audio/wav")
        }
        "audio" if bytes.starts_with(b"fLaC") => Ok("audio/flac"),
        "audio"
            if bytes.starts_with(b"ID3")
                || (bytes.len() > 1 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0) =>
        {
            Ok("audio/mpeg")
        }
        "audio" if ogg => Ok("audio/ogg"),
        "audio" if iso => Ok("audio/mp4"),
        "video" if iso => Ok("video/mp4"),
        "video" if ebml => Ok("video/webm"),
        "video" if ogg => Ok("video/ogg"),
        _ => Err(Error::Io(
            "Сервер вернул файл неподдерживаемого формата.".into(),
        )),
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::{
        ffi::c_void,
        ptr,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::Networking::WinHttp::*;

    struct Handle(*mut c_void);
    impl Handle {
        fn new(raw: *mut c_void) -> Result<Self> {
            if raw.is_null() {
                Err(Error::Io(
                    "Не удалось открыть соединение с сервером.".into(),
                ))
            } else {
                Ok(Self(raw))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn check(ok: i32) -> Result<()> {
        if ok == 0 {
            Err(Error::Io(
                "Не удалось загрузить внешний файл. Проверьте адрес и соединение.".into(),
            ))
        } else {
            Ok(())
        }
    }
    fn option(request: &Handle, key: u32, value: u32) -> Result<()> {
        unsafe {
            check(WinHttpSetOption(
                request.0,
                key,
                &value as *const u32 as *const c_void,
                4,
            ))
        }
    }
    pub(super) enum Response {
        Redirect(String),
        Body(Vec<u8>),
    }
    pub(super) fn request(url: &Url, address: SocketAddr, limit: usize) -> Result<Response> {
        let host = url.host_str().ok_or_else(bad_url)?.trim_matches(['[', ']']);
        let host = wide(host);
        let agent = wide("Aether/1.0");
        let session = Handle::new(unsafe {
            WinHttpOpen(
                agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            )
        })?;
        unsafe {
            check(WinHttpSetTimeouts(session.0, 8000, 8000, 8000, 8000))?;
        }
        let connection =
            Handle::new(unsafe { WinHttpConnect(session.0, host.as_ptr(), address.port(), 0) })?;
        let mut path = url.path().to_owned();
        if path.is_empty() {
            path.push('/');
        }
        if let Some(query) = url.query() {
            path.push('?');
            path.push_str(query);
        }
        let path = wide(&path);
        let verb = wide("GET");
        let request = Handle::new(unsafe {
            WinHttpOpenRequest(
                connection.0,
                verb.as_ptr(),
                path.as_ptr(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                if url.scheme() == "https" {
                    WINHTTP_FLAG_SECURE
                } else {
                    0
                },
            )
        })?;
        option(
            &request,
            WINHTTP_OPTION_REDIRECT_POLICY,
            WINHTTP_OPTION_REDIRECT_POLICY_NEVER,
        )?;
        option(
            &request,
            WINHTTP_OPTION_DISABLE_FEATURE,
            WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION,
        )?;
        option(
            &request,
            WINHTTP_OPTION_AUTOLOGON_POLICY,
            WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH,
        )?;
        // Keep the original URL hostname for Host and TLS validation while pinning DNS to
        // the address validated above. A failure to set this option rejects the request.
        let fixed_ip = wide(&address.ip().to_string());
        unsafe {
            check(WinHttpSetOption(
                request.0,
                WINHTTP_OPTION_RESOLUTION_HOSTNAME,
                fixed_ip.as_ptr() as *const c_void,
                (fixed_ip.len() * 2) as u32,
            ))?;
        }
        unsafe {
            check(WinHttpSendRequest(
                request.0,
                ptr::null(),
                0,
                ptr::null(),
                0,
                0,
                0,
            ))?;
            check(WinHttpReceiveResponse(request.0, ptr::null_mut()))?;
        }
        let mut status = 0u32;
        let mut length = 4u32;
        unsafe {
            check(WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                ptr::null(),
                &mut status as *mut u32 as *mut c_void,
                &mut length,
                ptr::null_mut(),
            ))?;
        }
        if (300..400).contains(&status) {
            let mut buffer = vec![0u16; 8193];
            let mut size = (buffer.len() * 2) as u32;
            unsafe {
                check(WinHttpQueryHeaders(
                    request.0,
                    WINHTTP_QUERY_LOCATION,
                    ptr::null(),
                    buffer.as_mut_ptr() as *mut c_void,
                    &mut size,
                    ptr::null_mut(),
                ))?;
            }
            let value =
                String::from_utf16_lossy(&buffer[..((size as usize / 2).min(buffer.len()))])
                    .trim_end_matches('\0')
                    .to_owned();
            if value.len() > 8192 {
                return Err(bad_url());
            }
            return Ok(Response::Redirect(value));
        }
        if !(200..300).contains(&status) {
            return Err(Error::Io(format!("Сервер не отдал файл (HTTP {status}).")));
        }
        let started = Instant::now();
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 16384];
        loop {
            if started.elapsed() > Duration::from_secs(30) {
                return Err(Error::Io("Загрузка заняла слишком много времени.".into()));
            }
            let mut read = 0;
            unsafe {
                check(WinHttpReadData(
                    request.0,
                    chunk.as_mut_ptr() as *mut c_void,
                    chunk.len() as u32,
                    &mut read,
                ))?;
            }
            if read == 0 {
                break;
            }
            if bytes.len() + read as usize > limit {
                return Err(Error::Io(
                    "Внешний файл превышает допустимый размер.".into(),
                ));
            }
            bytes.extend_from_slice(&chunk[..read as usize]);
        }
        Ok(Response::Body(bytes))
    }
}

pub fn fetch(raw: &str, kind: &str) -> Result<attachments::Media> {
    let limit = match kind {
        "image" => IMAGE_LIMIT,
        "audio" | "video" | "pdf" => MEDIA_LIMIT,
        _ => return Err(bad_url()),
    };
    let mut url = parse_url(raw)?;
    #[cfg(windows)]
    for redirects in 0..=MAX_REDIRECTS {
        let address = resolve(&url)?;
        match win::request(&url, address, limit)? {
            win::Response::Body(bytes) => {
                return Ok(attachments::Media {
                    mime: media_mime(kind, &bytes)?.into(),
                    data: STANDARD.encode(bytes),
                })
            }
            win::Response::Redirect(location) => {
                if redirects == MAX_REDIRECTS {
                    return Err(Error::Io("Слишком много перенаправлений.".into()));
                }
                let next = url.join(&location).map_err(|_| bad_url())?;
                let next = parse_url(next.as_str())?;
                if url.scheme() == "https" && next.scheme() != "https" {
                    return Err(bad_url());
                }
                url = next;
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (limit, &mut url);
        return Err(Error::Io(
            "Внешние вложения пока доступны только в Windows.".into(),
        ));
    }
    #[cfg(windows)]
    Err(Error::Io("Не удалось загрузить внешний файл.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_and_content_are_checked() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.1.2",
            "169.254.169.254",
            "192.168.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "2002:0808:0808::1",
            "2001:db8::1",
        ] {
            assert!(!public_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "2606:4700:4700::1111"] {
            assert!(public_ip(ip.parse().unwrap()), "{ip}");
        }
        for url in [
            "file:///etc/passwd",
            "http://user:pass@example.com",
            "https://example.com/\nfoo",
        ] {
            assert!(parse_url(url).is_err());
        }
        assert!(media_mime("image", b"<svg><script>alert(1)</script></svg>").is_err());
        assert!(media_mime("image", b"\x89PNG\r\n\x1a\n").is_ok());
        assert!(media_mime("video", b"<html>not video</html>").is_err());
        assert!(resolve(&parse_url("http://127.0.0.1:80/file").unwrap()).is_err());
    }
    #[test]
    #[ignore = "requires an explicit public HTTPS connection"]
    fn public_https_image_and_redirect() {
        let image = fetch(
            "https://www.rust-lang.org/logos/rust-logo-512x512.png",
            "image",
        )
        .unwrap();
        assert_eq!(image.mime, "image/png");
    }
    #[cfg(windows)]
    #[test]
    fn transport_pins_address_and_does_not_follow_redirect() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let (mut client, _) = server.accept().unwrap();
            let mut request = [0u8; 2048];
            let size = client.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
            assert!(request.contains("host: example.test"));
            assert!(!request.contains("cookie:"));
            client.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let url = parse_url(&format!("http://example.test:{}/image", addr.port())).unwrap();
        match win::request(&url, addr, 100).unwrap() {
            win::Response::Redirect(location) => assert_eq!(location, "http://127.0.0.1/private"),
            _ => panic!("redirect followed"),
        }
        worker.join().unwrap();
    }
}
