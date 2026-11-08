package br.uca.almox.mobile;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.rule.GrantPermissionRule;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.*;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.*;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class MobileAppTest {
    @Rule public GrantPermissionRule camera = GrantPermissionRule.grant(Manifest.permission.CAMERA);
    private ActivityScenario<MainActivity> scenario;
    private static final String FIXTURE = "https://almox.example.invalid";

    @Before public void reset() {
        InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("connection", Activity.MODE_PRIVATE).edit().clear().commit();
    }
    @After public void close() { if (scenario != null) scenario.close(); }
    @Test public void firstScreenHasUcaConnectionAndRejectsHttp() {
        scenario = ActivityScenario.launch(MainActivity.class);
        onView(withId(R.id.connect_button)).check(matches(isDisplayed()));
        onView(withId(R.id.origin_input)).perform(replaceText("http://almox.example.invalid"), closeSoftKeyboard());
        onView(withId(R.id.connect_button)).perform(click());
        onView(withId(R.id.status_text)).check(matches(withSubstring("HTTPS")));
    }

    private WebView fixture(String html) throws Exception {
        InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("connection", Activity.MODE_PRIVATE).edit().putString("origin", FIXTURE).commit();
        scenario = ActivityScenario.launch(MainActivity.class);
        AtomicReference<WebView> target = new AtomicReference<>();
        scenario.onActivity(activity -> {
            WebView web = activity.findViewById(R.id.web_view); web.stopLoading();
            web.loadDataWithBaseURL(FIXTURE + "/login", "<!doctype html><meta name='viewport' content='width=device-width'><h1>Almox — dados fictícios</h1>" + html, "text/html", "UTF-8", null);
            target.set(web);
        });
        waitJs(target.get(), "document.readyState", "\"complete\"", 15);
        return target.get();
    }
    private String js(WebView web, String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1); AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> web.evaluateJavascript(expression, value -> { result.set(value); done.countDown(); }));
        assertTrue("JavaScript callback", done.await(10, TimeUnit.SECONDS)); return result.get();
    }
    private void waitJs(WebView web, String expression, String expected, int seconds) throws Exception {
        long until = System.currentTimeMillis() + seconds * 1000L; String actual = "";
        while (System.currentTimeMillis() < until) { actual = js(web, expression); if (expected.equals(actual)) return; Thread.sleep(150); }
        assertEquals(expected, actual);
    }
    @Test public void webViewKeepsFilesAndMixedContentBlocked() throws Exception {
        WebView web = fixture("");
        scenario.onActivity(activity -> {
            assertFalse(web.getSettings().getAllowFileAccess());
            assertEquals(WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.getSettings().getMixedContentMode());
            assertFalse(CookieManager.getInstance().acceptThirdPartyCookies(web));
        });
        waitJs(web, "typeof AlmoxNative", "\"object\"", 10);
        scenario.onActivity(activity -> web.loadDataWithBaseURL("https://outside.example.invalid/", "<h1>Outro domínio</h1>", "text/html", "UTF-8", null));
        waitJs(web, "typeof AlmoxNative", "\"undefined\"", 10);
    }
    @Test public void cameraCanStartAndStopOnTrustedHttpsOrigin() throws Exception {
        WebView web = fixture("<video autoplay muted playsinline id='camera'></video>");
        waitJs(web, "window.isSecureContext", "true", 10);
        js(web, "window.cameraStatus='pending';navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false}).then(s=>{window.cameraStream=s;document.querySelector('video').srcObject=s;window.cameraStatus=s.getVideoTracks().length?'ready':'empty'}).catch(e=>window.cameraStatus=e.name)");
        waitJs(web, "window.cameraStatus", "\"ready\"", 30);
        js(web, "window.cameraStream.getTracks().forEach(t=>t.stop());window.cameraStatus=window.cameraStream.getVideoTracks()[0].readyState");
        waitJs(web, "window.cameraStatus", "\"ended\"", 10);
    }
}
