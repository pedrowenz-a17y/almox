package br.uca.almox.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {
    private static final int RED = Color.rgb(237, 11, 60), INK = Color.rgb(33, 34, 40);
    private static final int CAMERA_REQUEST = 100, FILE_REQUEST = 101;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private LinearLayout root;
    private FrameLayout content;
    private ProgressBar progress;
    private WebView browser;
    private String origin;
    private TextView status;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> fileCallback;
    private NativeFiles nativeFiles;
    private AlertDialog popup;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); return insets;
        });
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(16), 0, dp(4), 0);
        ImageView mark = new ImageView(this); mark.setImageResource(R.drawable.uca_icon); mark.setContentDescription("U.C.A.");
        toolbar.addView(mark, new LinearLayout.LayoutParams(dp(34), dp(34)));
        TextView title = text("Almox ERP", 16, INK, true); title.setPadding(dp(10), 0, 0, 0);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1)); title.setGravity(Gravity.CENTER_VERTICAL);
        TextView menu = text("⋮", 27, INK, false); menu.setGravity(Gravity.CENTER); menu.setContentDescription("Opções do aplicativo"); menu.setId(R.id.menu_button);
        toolbar.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48))); menu.setOnClickListener(this::showMenu);
        root.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(50)));
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2))); progress.setVisibility(View.GONE);
        content = new FrameLayout(this); root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        nativeFiles = new NativeFiles(this, worker);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (popup != null && popup.isShowing()) popup.dismiss();
                else if (browser != null && browser.canGoBack()) browser.goBack(); else finish();
            }
        });
        String saved = preferences.getString("origin", "");
        if (saved != null && !saved.isEmpty()) {
            try { origin = ConnectionPolicy.origin(saved); openErp(); }
            catch (IllegalArgumentException error) { configure(error.getMessage()); }
        } else configure("");
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setLineSpacing(dp(3), 1); if (bold) view.setTypeface(null, Typeface.BOLD); return view;
    }
    private GradientDrawable surface(int color, int stroke) {
        GradientDrawable shape = new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(12));
        if (stroke != 0) shape.setStroke(dp(1), stroke); return shape;
    }
    private Button button(String label, int id) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setTextColor(Color.WHITE); view.setTextSize(14);
        view.setBackground(surface(RED, 0)); view.setMinHeight(dp(52)); view.setId(id); return view;
    }

    private void configure(String error) {
        if (browser != null) { browser.destroy(); browser = null; }
        content.removeAllViews(); progress.setVisibility(View.GONE);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(26), dp(30), dp(26), dp(28));
        scroll.addView(box); content.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.uca_icon); logo.setContentDescription("U.C.A. Implementos Agrícolas");
        box.addView(logo, new LinearLayout.LayoutParams(dp(86), dp(86)));
        TextView eyebrow = text("DO ALMOXARIFADO À PRODUÇÃO", 10, RED, true); eyebrow.setPadding(0, dp(24), 0, dp(12)); box.addView(eyebrow);
        box.addView(text("Seu almoxarifado,\naonde você for.", 31, INK, true));
        TextView description = text("Conecte à sua unidade para consultar peças, ler etiquetas e registrar as operações.", 14, Color.rgb(112, 116, 131), false);
        description.setPadding(0, dp(14), 0, dp(28)); box.addView(description);
        TextView label = text("Endereço do ERP", 13, INK, true); box.addView(label);
        EditText input = new EditText(this); input.setId(R.id.origin_input); input.setSingleLine(true); input.setTextSize(13);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        input.setPadding(dp(14), dp(10), dp(14), dp(10)); input.setBackground(surface(Color.rgb(249, 249, 253), Color.rgb(221, 224, 234)));
        input.setHint("https://seu-erp.vercel.app"); input.setText(preferences.getString("origin", BuildConfig.ERP_ORIGIN));
        LinearLayout.LayoutParams field = new LinearLayout.LayoutParams(-1, dp(56)); field.topMargin = dp(8); box.addView(input, field);
        Button connect = button("Conectar à minha unidade", R.id.connect_button);
        LinearLayout.LayoutParams action = new LinearLayout.LayoutParams(-1, dp(54)); action.topMargin = dp(18); box.addView(connect, action);
        status = text(error, 12, RED, false); status.setId(R.id.status_text); status.setPadding(0, dp(15), 0, dp(12)); box.addView(status);
        TextView note = text("O PC pode ficar desligado quando o servidor está na nuvem. Use sua conta autorizada; o aplicativo não precisa do arquivo .env.", 12, Color.rgb(125, 129, 143), false); box.addView(note);
        connect.setOnClickListener(view -> {
            final String candidate;
            try { candidate = ConnectionPolicy.origin(input.getText().toString()); }
            catch (IllegalArgumentException exception) { status.setText(exception.getMessage()); return; }
            connect.setEnabled(false); status.setText("Conferindo o servidor…");
            worker.execute(() -> {
                String result = checkServer(candidate);
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    connect.setEnabled(true);
                    if (result != null) { status.setText(result); return; }
                    CookieManager.getInstance().removeAllCookies(ignored -> {
                        WebStorage.getInstance().deleteAllData();
                        origin = candidate; preferences.edit().putString("origin", origin).apply(); openErp();
                    });
                });
            });
        });
    }

    private String checkServer(String candidate) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(candidate + "/login").openConnection();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
            try {
                if (connection.getResponseCode() != 200) return "O login do ERP ainda não está disponível neste endereço. Confira a publicação do servidor.";
                byte[] bytes = NativeFiles.readBounded(connection.getInputStream(), 1024 * 1024);
                String html = new String(bytes, StandardCharsets.UTF_8);
                if (!html.contains("Almox") || !html.contains("Entrar no almoxarifado")) return "O endereço respondeu, mas não mostrou o login do Almox. Confira a publicação na Vercel.";
                return null;
            } finally { connection.disconnect(); }
        } catch (Exception ignored) { return "Não foi possível conectar com segurança. Confira a internet e o endereço HTTPS do ERP."; }
    }

    private void openErp() {
        content.removeAllViews();
        browser = new WebView(this); browser.setId(R.id.web_view); configureBrowser(browser, false);
        content.addView(browser, new FrameLayout.LayoutParams(-1, -1)); browser.loadUrl(origin + "/login");
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void configureBrowser(WebView view, boolean child) {
        WebSettings settings = view.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false); settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true); settings.setBuiltInZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
        nativeFiles.attach(view, origin, child);
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                if (ConnectionPolicy.sameOrigin(request.getUrl().toString(), origin)) return false;
                if (request.isForMainFrame()) externalLink(request.getUrl()); return true;
            }
            @Override public void onReceivedSslError(WebView web, SslErrorHandler handler, SslError error) {
                handler.cancel(); if (!child) connectionError("O certificado do servidor não pôde ser validado. Confira o endereço e a data do celular.");
            }
            @Override public void onReceivedError(WebView web, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !child) connectionError("Sem acesso ao servidor. Confira a internet e tente novamente.");
            }
            @Override public void onPageFinished(WebView web, String url) {
                if (ConnectionPolicy.sameOrigin(url, origin) || child && "about:blank".equals(url)) nativeFiles.installHelpers(web);
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView web, int value) {
                if (!child) { progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE); }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!ConnectionPolicy.sameOrigin(request.getOrigin().toString(), origin) || !ConnectionPolicy.videoOnly(request.getResources())) { request.deny(); return; }
                    if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    else { if (cameraRequest != null) cameraRequest.deny(); cameraRequest = request; requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST); }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (cameraRequest == request) cameraRequest = null; }
            @Override public boolean onShowFileChooser(WebView web, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/png", "image/jpeg", "image/webp"});
                try { startActivityForResult(intent, FILE_REQUEST); } catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
            @Override public boolean onCreateWindow(WebView web, boolean dialog, boolean gesture, android.os.Message result) {
                if (!gesture || !ConnectionPolicy.sameOrigin(web.getUrl(), origin)) return false;
                WebView printView = new WebView(MainActivity.this); configureBrowser(printView, true);
                printView.setLayoutParams(new ViewGroup.LayoutParams(-1, Math.max(dp(160), Math.min(dp(460), getResources().getDisplayMetrics().heightPixels - dp(160)))));
                popup = new AlertDialog.Builder(MainActivity.this).setTitle("Documento do Almox").setView(printView)
                    .setPositiveButton("Imprimir", null).setNegativeButton("Fechar", null).create();
                popup.setOnDismissListener(ignored -> printView.destroy()); popup.show();
                popup.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(ignored -> print(printView));
                ((WebView.WebViewTransport) result.obj).setWebView(printView); result.sendToTarget(); return true;
            }
        });
        view.setDownloadListener((url, agent, disposition, mime, length) -> nativeFiles.download(view, origin, url, disposition, mime, length));
    }

    private void externalLink(Uri uri) {
        if (!"https".equals(uri.getScheme())) return;
        new AlertDialog.Builder(this).setTitle("Abrir no navegador?").setMessage(uri.getHost())
            .setPositiveButton("Abrir", (dialog, which) -> { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { toast("Nenhum navegador disponível."); } })
            .setNegativeButton("Cancelar", null).show();
    }
    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor); menu.getMenu().add(0, 1, 0, "Atualizar"); menu.getMenu().add(0, 2, 1, "Conexão");
        menu.getMenu().add(0, 3, 2, "Imprimir página"); menu.getMenu().add(0, 4, 3, "Sobre");
        menu.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 1: if (browser != null) browser.reload(); break;
                case 2: configure(""); break;
                case 3: if (browser != null) print(browser); break;
                case 4: new AlertDialog.Builder(this).setTitle("Almox ERP " + BuildConfig.VERSION_NAME)
                    .setMessage("U.C.A. Implementos Agrícolas\nDados compartilhados pela mesma unidade do ERP. O servidor precisa estar disponível na nuvem.")
                    .setPositiveButton("Fechar", null).show(); break;
                default: return false;
            }
            return true;
        }); menu.show();
    }
    private void connectionError(String message) {
        if (isFinishing() || browser == null) return;
        progress.setVisibility(View.GONE);
        new AlertDialog.Builder(this).setTitle("Conexão com o Almox").setMessage(message)
            .setPositiveButton("Tentar novamente", (dialog, which) -> { if (browser != null) browser.loadUrl(origin + "/login"); })
            .setNegativeButton("Conexão", (dialog, which) -> configure(message)).show();
    }
    void print(WebView view) {
        PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
        manager.print("Almox ERP", view.createPrintDocumentAdapter("Almox ERP"), null);
    }
    void toast(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }
    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] result) {
        super.onRequestPermissionsResult(code, permissions, result);
        if (code == CAMERA_REQUEST && cameraRequest != null) {
            if (result.length > 0 && result[0] == PackageManager.PERMISSION_GRANTED) cameraRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else cameraRequest.deny();
            cameraRequest = null;
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST && fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null; }
        else nativeFiles.onResult(request, result, data);
    }
    @Override protected void onPause() { if (browser != null) browser.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (browser != null) browser.onResume(); }
    @Override protected void onDestroy() {
        if (cameraRequest != null) cameraRequest.deny(); if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (browser != null) browser.destroy(); if (popup != null) popup.dismiss(); worker.shutdownNow(); super.onDestroy();
    }
}
