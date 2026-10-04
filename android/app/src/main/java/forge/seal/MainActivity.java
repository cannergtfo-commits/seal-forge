package forge.seal;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.lang.reflect.Method;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

public class MainActivity extends Activity {
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        allowFileScripts(settings);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSavePassword(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setBackgroundColor(0xFF0C0E12);
        web.addJavascriptInterface(new VaultBridge(this), "SealVault");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new AssetClient());
        web.loadUrl("file:///android_asset/index.html");
    }

    private static void allowFileScripts(WebSettings settings) {
        try {
            Method files = WebSettings.class.getMethod("setAllowFileAccessFromFileURLs", boolean.class);
            Method any = WebSettings.class.getMethod("setAllowUniversalAccessFromFileURLs", boolean.class);
            files.invoke(settings, true);
            any.invoke(settings, true);
        } catch (Exception ignored) {
            /* older WebView builds hide these switches */
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return false;
            Uri uri = request.getUrl();
            String host = uri.getHost() == null ? "" : uri.getHost();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            boolean wallet = host.contains("metamask") || host.contains("phantom") || scheme.startsWith("metamask") || scheme.startsWith("phantom");
            if (!wallet) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                return false;
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return null;
            String path = request.getUrl().getPath();
            if (path == null || !path.startsWith("/assets/")) return null;
            String local = path.startsWith("/") ? path.substring(1) : path;
            try {
                InputStream stream = getAssets().open(local);
                return new WebResourceResponse(mime(path), null, stream);
            } catch (IOException ignored) {
                return null;
            }
        }
    }

    private static String mime(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
