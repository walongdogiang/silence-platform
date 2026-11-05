use silence_engine::bind_policy::ensure_loopback_tcp_bind;

#[test]
fn bind_refuses_non_loopback() {
    for host in ["0.0.0.0:0", "0.0.0.0:8080", "192.168.1.10:9000", "*:0"] {
        assert!(
            ensure_loopback_tcp_bind(host).is_err(),
            "non-loopback bind target must be refused before TcpListener::bind: {host}"
        );
    }
    // Loopback forms remain allowed once the policy is real (Plan 01-04).
    // Wave 0 stub returns Ok for everything — including the cases above — so this test fails.
}
