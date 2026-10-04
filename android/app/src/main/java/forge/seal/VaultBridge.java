package forge.seal;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import java.io.OutputStream;
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
