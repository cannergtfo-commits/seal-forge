package forge.seal;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

public final class VaultBridge {
    private static final Pattern KEY = Pattern.compile("(?i)0x[0-9a-f]{64}");
    private final Activity activity;

    VaultBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String read() {
        return KeyVault.read(activity);
    }

    @JavascriptInterface
    public void write(String value) {
        if (value == null || !KEY.matcher(value.trim()).matches()) return;
        try {
            KeyVault.write(activity, value.trim());
        } catch (Exception ignored) {
            /* leave the previous lock in place */
        }
    }

    @JavascriptInterface
    public void clear() {
        KeyVault.clear(activity);
    }

    @JavascriptInterface
    public void secure(boolean on) {
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        });
    }

    @JavascriptInterface
    public String request(String method, String path, String body) {
        if (path == null || !path.startsWith("/api/veilforge") || path.contains("..") || path.contains("://")) {
            return "{\"status\":400,\"body\":\"\"}";
        }
        String verb = method == null ? "GET" : method.toUpperCase();
        if (!verb.equals("GET") && !verb.equals("POST")) return "{\"status\":405,\"body\":\"\"}";
        byte[] payload = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
        if (payload.length > 200000) return "{\"status\":413,\"body\":\"\"}";
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL("https://play.blazarforce.net" + path).openConnection();
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod(verb);
            conn.setRequestProperty("Accept", "application/json");
            if (verb.equals("POST")) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.getOutputStream().write(payload);
            }
            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            return "{\"status\":" + status + ",\"body\":" + org.json.JSONObject.quote(readStream(stream)) + "}";
        } catch (Exception ignored) {
            return "{\"status\":0,\"body\":\"\"}";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int count;
        while ((count = stream.read(buf)) >= 0) {
            out.write(buf, 0, count);
            if (out.size() > 1000000) break;
        }
        stream.close();
        return out.toString(StandardCharsets.UTF_8);
    }

    /** Saves the password-locked key file. Refuses a raw private key. */
    @JavascriptInterface
    public boolean saveFile(String name, String text) {
        if (name == null || text == null || text.length() > 20000 || text.length() < 16) return false;
        if (KEY.matcher(text).find()) return false;
        String safe = name.replaceAll("[^A-Za-z0-9._-]", "");
        if (!safe.endsWith(".json") || safe.length() < 6) return false;
        try {
            if (Build.VERSION.SDK_INT >= 29) return saveDownloads(safe, text);
            return saveLegacy(safe, text);
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean saveDownloads(String name, String text) throws Exception {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return false;
        try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
            if (out == null) return false;
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        activity.getContentResolver().update(uri, values, null, null);
        return true;
    }

    private boolean saveLegacy(String name, String text) throws Exception {
        java.io.File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return false;
        if (!dir.exists() && !dir.mkdirs()) return false;
        java.io.File file = new java.io.File(dir, name);
        try (OutputStream out = new java.io.FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return true;
    }
}
