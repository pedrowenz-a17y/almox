package br.uca.almox.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class ConnectionPolicyTest {
    @Test public void acceptsPublishedHttpsAndNormalizesDefaultPort() {
        assertEquals("https://almox.example.com", ConnectionPolicy.origin(" https://Almox.Example.com:443/ "));
        assertEquals("https://almox.example.com:8443", ConnectionPolicy.origin("https://almox.example.com:8443"));
    }
    @Test public void rejectsLocalCredentialsPathsAndInsecureSchemes() {
        String[] bad = {"http://almox.example.com", "https://localhost", "https://127.0.0.1", "https://10.1.1.1", "https://almox.local", "https://a.example.com/login", "https://a.example.com/?key=1", "https://user:pass@a.example.com", "https://a.example.com/#test", "javascript:alert(1)", "file:///etc/passwd", "https://a.example.com:0"};
        for (String value : bad) { try { ConnectionPolicy.origin(value); fail(value); } catch (IllegalArgumentException expected) {} }
    }
    @Test public void comparesOriginsRatherThanPrefixes() {
        String trusted = "https://almox.example.com";
        assertTrue(ConnectionPolicy.sameOrigin(trusted + "/api/products?id=1", trusted));
        assertTrue(ConnectionPolicy.sameOrigin("https://almox.example.com:443/login", trusted));
        assertFalse(ConnectionPolicy.sameOrigin("https://almox.example.com.evil.com", trusted));
        assertFalse(ConnectionPolicy.sameOrigin("http://almox.example.com", trusted));
        assertFalse(ConnectionPolicy.sameOrigin("https://almox.example.com:444", trusted));
        assertFalse(ConnectionPolicy.sameOrigin("https://fake@almox.example.com", trusted));
    }
    @Test public void neverGrantsAudioOrMixedCameraRequests() {
        assertTrue(ConnectionPolicy.videoOnly(new String[]{"android.webkit.resource.VIDEO_CAPTURE"}));
        assertFalse(ConnectionPolicy.videoOnly(new String[]{"android.webkit.resource.AUDIO_CAPTURE"}));
        assertFalse(ConnectionPolicy.videoOnly(new String[]{"android.webkit.resource.VIDEO_CAPTURE", "android.webkit.resource.AUDIO_CAPTURE"}));
        assertFalse(ConnectionPolicy.videoOnly(null));
    }
    @Test public void downloadsKeepSafeNamesAndSupportedFormats() {
        assertEquals("relatório.csv", ConnectionPolicy.filename("../../relatório.csv", "text/csv;charset=utf-8"));
        assertEquals("payload.exe.pdf", ConnectionPolicy.filename("payload.exe", "application/pdf"));
        assertEquals("arquivo.png", ConnectionPolicy.filename("...", "image/png"));
        for (String type : new String[]{"text/html", "application/javascript", "application/vnd.android.package-archive"}) {
            try { ConnectionPolicy.mime(type); fail(type); } catch (IllegalArgumentException expected) {}
        }
    }
}
