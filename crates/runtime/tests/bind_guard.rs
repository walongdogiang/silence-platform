use silence_engine::bind_policy::ensure_loopback_tcp_bind;

#[test]
fn bind_refuses_non_loopback() {
    for host in ["0.0.0.0:0", "0.0.0.0:8080", "192.168.1.10:9000", "*:0"] {
        assert!(
            ensure_loopback_tcp_bind(host).is_err(),
            "non-loopback bind target must be refused before TcpListener::bind: {host}"
        );
    }
    for host in ["127.0.0.1:0", "localhost:0", "[::1]:0"] {
        assert!(
            ensure_loopback_tcp_bind(host).is_ok(),
            "loopback bind must stay allowed: {host}"
        );
    }
}
