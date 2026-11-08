package br.uca.almox.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

/** Only same-origin, main-frame messages can request printing or a user-approved save dialog. */
final class NativeFiles {
    private static final int SAVE_REQUEST = 102;
    private final MainActivity activity;
    private final ExecutorService worker;
    private byte[] pending;
    NativeFiles(MainActivity activity, ExecutorService worker) { this.activity = activity; this.worker = worker; }

    void attach(WebView web, String origin, boolean popup) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        WebViewCompat.addWebMessageListener(web, "AlmoxNative", Collections.singleton(origin), (view, message, source, mainFrame, reply) -> {
            if (!mainFrame || !ConnectionPolicy.sameOrigin(source.toString(), origin) ||
                !(ConnectionPolicy.sameOrigin(view.getUrl(), origin) || popup && "about:blank".equals(view.getUrl())) ||
                message.getType() != WebMessageCompat.TYPE_STRING) return;
            String value = message.getData();
            if (value == null || value.length() > (ConnectionPolicy.MAX_DOWNLOAD * 4 / 3) + 4096) { activity.toast("O arquivo é grande demais. Use o Almox no computador."); return; }
            try {
                JSONObject json = new JSONObject(value);
                String action = json.getString("action");
                if ("print".equals(action)) { activity.print(view); return; }
                if (!"download".equals(action)) return;
                String type = ConnectionPolicy.mime(json.getString("mime"));
                String name = ConnectionPolicy.filename(json.optString("name", "arquivo"), type);
                byte[] data = Base64.decode(json.getString("data"), Base64.DEFAULT);
                if (data.length == 0 || data.length > ConnectionPolicy.MAX_DOWNLOAD) throw new IllegalArgumentException();
                save(data, type, name);
            } catch (Exception ignored) { activity.toast("Não foi possível preparar esse arquivo para salvar."); }
        });
    }

    void installHelpers(WebView web) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        web.evaluateJavascript("""
            (()=>{
              if(window.__almoxAndroidFiles || typeof AlmoxNative==='undefined')return;
              window.__almoxAndroidFiles=true;
              window.print=()=>AlmoxNative.postMessage(JSON.stringify({action:'print'}));
              document.addEventListener('click', async event=>{
                const a=event.target?.closest?.('a[download]');
                if(!a||!a.href.startsWith('blob:'))return;
                event.preventDefault();
                try{
                  const blob=await(await fetch(a.href)).blob();
                  if(blob.size>10485760){alert('Este arquivo é grande demais. Use o Almox no computador.');return;}
                  const reader=new FileReader();
                  reader.onload=()=>AlmoxNative.postMessage(JSON.stringify({action:'download',name:a.download,mime:blob.type,data:String(reader.result).split(',')[1]}));
                  reader.readAsDataURL(blob);
                }catch{alert('Não foi possível baixar o arquivo. Tente novamente.');}
              },true);
            })();
            """, null);
    }

    void download(WebView web, String origin, String url, String disposition, String suppliedType, long length) {
        if (!ConnectionPolicy.sameOrigin(url, origin) || length > ConnectionPolicy.MAX_DOWNLOAD) { activity.toast("Abra o relatório no servidor autorizado do Almox."); return; }
        final String type;
        try { type = ConnectionPolicy.mime(suppliedType); } catch (Exception error) { activity.toast(error.getMessage()); return; }
        String cookies = CookieManager.getInstance().getCookie(url), agent = web.getSettings().getUserAgentString();
        worker.execute(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(25000);
                if (cookies != null) connection.setRequestProperty("Cookie", cookies);
                connection.setRequestProperty("User-Agent", agent);
                try {
                    if (connection.getResponseCode() != 200) throw new IllegalArgumentException();
                    String actual = ConnectionPolicy.mime(connection.getContentType());
                    byte[] bytes = readBounded(connection.getInputStream(), ConnectionPolicy.MAX_DOWNLOAD);
                    String name = ConnectionPolicy.filename(URLUtil.guessFileName(url, disposition, type), actual);
                    List<String> renewedCookies = new ArrayList<>();
                    for (var header : connection.getHeaderFields().entrySet())
                        if ("set-cookie".equalsIgnoreCase(header.getKey())) renewedCookies.addAll(header.getValue());
                    activity.runOnUiThread(() -> {
                        for (String cookie : renewedCookies) CookieManager.getInstance().setCookie(url, cookie);
                        CookieManager.getInstance().flush();
                        save(bytes, actual, name);
                    });
                } finally { connection.disconnect(); }
            } catch (Exception ignored) { activity.toast("O download não foi concluído. Confira a conexão e sua sessão."); }
        });
    }

    private void save(byte[] bytes, String type, String name) {
        if (pending != null) { activity.toast("Conclua ou cancele o arquivo anterior antes de salvar outro."); return; }
        pending = bytes;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type).putExtra(Intent.EXTRA_TITLE, name);
        try { activity.startActivityForResult(intent, SAVE_REQUEST); }
        catch (Exception error) { pending = null; activity.toast("Nenhum aplicativo disponível para salvar o documento."); }
    }

    void onResult(int request, int result, Intent intent) {
        if (request != SAVE_REQUEST) return;
        byte[] bytes = pending; pending = null;
        if (result != Activity.RESULT_OK || intent == null || intent.getData() == null || bytes == null) return;
        Uri destination = intent.getData();
        worker.execute(() -> {
            try (OutputStream output = activity.getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IllegalArgumentException(); output.write(bytes); activity.toast("Arquivo salvo.");
            } catch (Exception ignored) { activity.toast("Não foi possível salvar o arquivo no local escolhido."); }
        });
    }

    static byte[] readBounded(InputStream input, int limit) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384]; int count;
            while ((count = stream.read(buffer)) != -1) {
                if (output.size() + count > limit) throw new IllegalArgumentException("Arquivo muito grande.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }
}
