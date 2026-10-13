package com.noor.frame;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.ScanResult;
import android.net.wifi.SupplicantState;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.net.URI;
import org.json.JSONArray;
import org.json.JSONObject;

// The Noor Frame Home app: the dashboard in a fullscreen WebView.
//
// The frame has no Back or Home button and no keyboard, so Android's own Wi-Fi screen would be a
// dead end. Wi-Fi is set up on Noor's own page instead (apps/kiosk-shared/setup.html, shared with
// the Raspberry Pi and bundled as assets/setup.html), which opens from Settings → Wi-Fi and
// whenever the server can't be reached, and goes back to the dashboard once the frame is online.
public class MainActivity extends Activity {
  private static final String TAG = "NoorFrame";
  private static final String DEFAULT_URL = "http://127.0.0.1:8787/";
  private static final String SETUP_URL = "file:///android_asset/setup.html";
  private WebView web;
  private WifiManager wifi;
  // The network that last rejected its password, so the setup page can say so.
  private volatile String authFailedSsid = "";
  // Why the setup page is showing: "offline" (the dashboard didn't load) or "settings" (opened
  // from the dashboard).
  private volatile String setupReason = "settings";

  private final BroadcastReceiver wifiEvents = new BroadcastReceiver() {
    @Override public void onReceive(Context context, Intent intent) {
      if (intent.getIntExtra(WifiManager.EXTRA_SUPPLICANT_ERROR, 0) == WifiManager.ERROR_AUTHENTICATING) {
        WifiInfo info = wifi.getConnectionInfo();
        authFailedSsid = info == null ? "" : unquote(info.getSSID());
        Log.w(TAG, "Wi-Fi password rejected for " + authFailedSsid);
      }
    }
  };

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        | WindowManager.LayoutParams.FLAG_FULLSCREEN);
    wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    registerReceiver(wifiEvents, new IntentFilter(WifiManager.SUPPLICANT_STATE_CHANGED_ACTION));
    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setUseWideViewPort(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (isAllowedUrl(url)) return false;
        Log.w(TAG, "Blocked navigation outside Noor's server or setup page");
        return true;
      }

      // Called only for the main page, so a failed image or API call never lands here.
      @Override public void onReceivedError(WebView view, int code, String description, String url) {
        Log.e(TAG, "Page error " + code + " at " + url + ": " + description);
        if (url != null && !url.startsWith("file:")) showSetup("offline");
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) {
        Log.i(TAG, "JS " + message.messageLevel() + " " + message.sourceId()
            + ":" + message.lineNumber() + " " + message.message());
        return true;
      }
    });
    web.addJavascriptInterface(new FrameBridge(), "Frame");
    setContentView(web);
    showDashboard(getIntent());
  }

  @Override
  protected void onDestroy() {
    unregisterReceiver(wifiEvents);
    super.onDestroy();
  }

  private String serverUrl() {
    return getPreferences(MODE_PRIVATE).getString("url", DEFAULT_URL);
  }

  private boolean isAllowedUrl(String url) {
    if (SETUP_URL.equals(url)) return true;
    return sameOrigin(url, serverUrl());
  }

  private static boolean sameOrigin(String first, String second) {
    try {
      URI a = new URI(first), b = new URI(second);
      String aScheme = a.getScheme(), bScheme = b.getScheme();
      if (aScheme == null || bScheme == null || a.getHost() == null || b.getHost() == null
          || a.getUserInfo() != null || b.getUserInfo() != null) return false;
      aScheme = aScheme.toLowerCase();
      bScheme = bScheme.toLowerCase();
      if (!("http".equals(aScheme) || "https".equals(aScheme))) return false;
      int aPort = a.getPort() == -1 ? ("https".equals(aScheme) ? 443 : 80) : a.getPort();
      int bPort = b.getPort() == -1 ? ("https".equals(bScheme) ? 443 : 80) : b.getPort();
      return aScheme.equals(bScheme) && a.getHost().equalsIgnoreCase(b.getHost()) && aPort == bPort;
    } catch (Exception e) {
      return false;
    }
  }

  private void showDashboard(Intent intent) {
    String url = intent == null ? null : intent.getDataString();
    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
      getPreferences(MODE_PRIVATE).edit().putString("url", url).apply();
    } else {
      url = serverUrl();
    }
    if (!sameOrigin(url, url)) {
      showSetup("offline");
      return;
    }
    Log.i(TAG, "Loading " + url);
    web.loadUrl(url);
  }

  private void showSetup(String reason) {
    setupReason = reason;
    Log.i(TAG, "Showing Wi-Fi setup (" + reason + ")");
    web.loadUrl(SETUP_URL);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    showDashboard(intent);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
          | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
          | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
  }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack();
  }

  private static String unquote(String ssid) {
    if (ssid == null || "<unknown ssid>".equals(ssid)) return "";
    if (ssid.length() >= 2 && ssid.startsWith("\"") && ssid.endsWith("\"")) {
      return ssid.substring(1, ssid.length() - 1);
    }
    return ssid;
  }

  // "open", "wpa" or "other" (WEP and enterprise networks, which need Android's own settings).
  private static String security(String capabilities) {
    if (capabilities.contains("EAP") || capabilities.contains("WEP")) return "other";
    if (capabilities.contains("PSK") || capabilities.contains("WPA")) return "wpa";
    return "open";
  }

  private WifiConfiguration saved(String ssid) {
    List<WifiConfiguration> list = wifi.getConfiguredNetworks();
    if (list == null) return null;
    for (WifiConfiguration c : list) {
      if (ssid.equals(unquote(c.SSID))) return c;
    }
    return null;
  }

  private class FrameBridge {
    @JavascriptInterface
    public void openWifiSettings() {
      runOnUiThread(new Runnable() {
        @Override public void run() { showSetup("settings"); }
      });
    }

    @JavascriptInterface
    public void openDashboard() {
      runOnUiThread(new Runnable() {
        @Override public void run() { showDashboard(null); }
      });
    }

    @JavascriptInterface
    public String setupReason() { return setupReason; }

    // The frame's media volume (athan and recitation), as {"level": 5, "max": 8}. The frame has
    // no volume buttons, so the dashboard's Settings → Sound sets it. No Android volume panel shows.
    @JavascriptInterface
    public String volume() {
      AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
      return "{\"level\":" + am.getStreamVolume(AudioManager.STREAM_MUSIC)
          + ",\"max\":" + am.getStreamMaxVolume(AudioManager.STREAM_MUSIC) + "}";
    }

    @JavascriptInterface
    public void setVolume(int level) {
      AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
      int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
      am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.max(0, Math.min(max, level)), 0);
      Log.i(TAG, "Volume set to " + level + " of " + max);
    }

    @JavascriptInterface
    public String serverUrl() { return MainActivity.this.serverUrl(); }

    @JavascriptInterface
    public boolean setServerUrl(String url) {
      url = url == null ? "" : url.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
      if (!sameOrigin(url, url) || !url.matches("https?://[^/\\s]+(/\\S*)?")) return false;
      if (!url.substring(url.indexOf("//") + 2).contains("/")) url += "/";
      getPreferences(MODE_PRIVATE).edit().putString("url", url).apply();
      Log.i(TAG, "Server address set to " + url);
      return true;
    }

    @JavascriptInterface
    public String status() {
      try {
        JSONObject s = new JSONObject();
        s.put("wifiOn", wifi.isWifiEnabled());
        WifiInfo info = wifi.getConnectionInfo();
        String ssid = info == null ? "" : unquote(info.getSSID());
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkInfo net = cm.getActiveNetworkInfo();
        boolean online = net != null && net.isConnected() && net.getType() == ConnectivityManager.TYPE_WIFI;
        s.put("connected", online);
        s.put("ssid", ssid);
        s.put("connecting", !online && info != null && info.getSupplicantState() != SupplicantState.DISCONNECTED
            && info.getSupplicantState() != SupplicantState.SCANNING
            && info.getSupplicantState() != SupplicantState.INACTIVE);
        s.put("authFailed", authFailedSsid);
        int ip = info == null ? 0 : info.getIpAddress();
        s.put("ip", ip == 0 ? "" : (ip & 255) + "." + (ip >> 8 & 255) + "." + (ip >> 16 & 255) + "." + (ip >> 24 & 255));
        return s.toString();
      } catch (Exception e) {
        Log.e(TAG, "Wi-Fi status failed", e);
        return "{}";
      }
    }

    // Starts a scan; the page asks for networks() again a moment later.
    @JavascriptInterface
    public void scan() {
      if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        // Android 6 only lists nearby networks to apps with location access. It asks once.
        runOnUiThread(new Runnable() {
          @Override public void run() {
            requestPermissions(new String[] { Manifest.permission.ACCESS_COARSE_LOCATION }, 1);
          }
        });
        return;
      }
      if (!wifi.isWifiEnabled()) wifi.setWifiEnabled(true);
      wifi.startScan();
    }

    @JavascriptInterface
    public String networks() {
      JSONArray out = new JSONArray();
      try {
        List<ScanResult> results = wifi.getScanResults();
        if (results == null) return "[]";
        // One entry per name, keeping the strongest signal.
        Map<String, ScanResult> best = new HashMap<String, ScanResult>();
        for (ScanResult r : results) {
          if (r.SSID == null || r.SSID.isEmpty()) continue;
          ScanResult had = best.get(r.SSID);
          if (had == null || r.level > had.level) best.put(r.SSID, r);
        }
        for (ScanResult r : best.values()) {
          JSONObject n = new JSONObject();
          n.put("ssid", r.SSID);
          n.put("security", security(r.capabilities));
          n.put("bars", WifiManager.calculateSignalLevel(r.level, 4));
          n.put("saved", saved(r.SSID) != null);
          out.put(n);
        }
      } catch (Exception e) {
        Log.e(TAG, "Wi-Fi scan results failed", e);
      }
      return out.toString();
    }

    // Joins a network. An empty password reuses a saved network's password, or joins an open one.
    @JavascriptInterface
    public boolean connect(String ssid, String password, String security) {
      try {
        if (!wifi.isWifiEnabled()) wifi.setWifiEnabled(true);
        authFailedSsid = "";
        WifiConfiguration existing = saved(ssid);
        int id = -1;
        if (existing != null && (password == null || password.isEmpty())) {
          id = existing.networkId;
        } else {
          WifiConfiguration c = new WifiConfiguration();
          c.SSID = "\"" + ssid + "\"";
          if ("wpa".equals(security)) {
            c.preSharedKey = "\"" + password + "\"";
          } else {
            c.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
          }
          if (existing != null) {
            // Android only lets an app change networks it saved itself; otherwise replace it.
            c.networkId = existing.networkId;
            id = wifi.updateNetwork(c);
            if (id == -1 && wifi.removeNetwork(existing.networkId)) c.networkId = -1;
          }
          if (id == -1) {
            c.networkId = -1;
            id = wifi.addNetwork(c);
          }
        }
        if (id == -1) {
          Log.e(TAG, "Couldn't save Wi-Fi network " + ssid);
          return false;
        }
        boolean ok = wifi.enableNetwork(id, true);
        wifi.saveConfiguration();
        wifi.reconnect();
        Log.i(TAG, "Joining Wi-Fi " + ssid + (ok ? "" : " (enable failed)"));
        return ok;
      } catch (Exception e) {
        Log.e(TAG, "Wi-Fi connect failed", e);
        return false;
      }
    }
  }

  @Override
  public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
    if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) wifi.startScan();
  }
}
