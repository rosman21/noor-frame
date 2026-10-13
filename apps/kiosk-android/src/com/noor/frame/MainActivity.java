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
import android.os.Handler;
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
import org.json.JSONArray;
import org.json.JSONObject;

// The Noor Frame Home app: the dashboard in a fullscreen WebView.
//
// The frame has no Back or Home button and no keyboard, so Android's own Wi-Fi screen would be a
// dead end. Wi-Fi is set up on Noor's own page instead (apps/kiosk-shared/setup.html, shared with
// the Raspberry Pi and bundled as assets/setup.html), which opens from Settings → Wi-Fi and
// whenever the server can't be reached, and goes back to the dashboard once the frame is online.
//
// The server's address is found on the network by itself (Server.Finder), typed on the Wi-Fi
// page, or set over USB (SetServerActivity). Only pages from that server and the setup page are
// ever shown, because both can use the Frame bridge (Wi-Fi, volume, server address).
public class MainActivity extends Activity {
  static final String TAG = "NoorFrame";
  static final String RELOAD = "com.noor.frame.RELOAD";
  private static final String SETUP_URL = "file:///android_asset/setup.html";
  private WebView web;
  private Server.Finder finder;
  private final Handler handler = new Handler();
  private boolean onSetup;
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
    finder = new Server.Finder(this, new Server.Finder.Listener() {
      @Override public void changed() {
        runOnUiThread(new Runnable() { @Override public void run() { maybeUseFound(); } });
      }
    });
    web.setWebViewClient(new WebViewClient() {
      // Links and redirects stay on the Noor server; anything else isn't opened at all.
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (isAllowedUrl(url)) return false;
        Log.w(TAG, "Blocked a page outside the Noor server: " + Server.origin(url));
        return true;
      }

      @Override public void onPageFinished(WebView view, String url) {
        if (Server.sameOrigin(url, serverUrl())) finder.stop();
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
    showDashboard();
  }

  @Override
  protected void onDestroy() {
    finder.stop();
    unregisterReceiver(wifiEvents);
    super.onDestroy();
  }

  private String serverUrl() { return Server.saved(this); }

  private boolean isAllowedUrl(String url) {
    return SETUP_URL.equals(url) || Server.sameOrigin(url, serverUrl());
  }

  // The saved server didn't answer (or none is saved yet) and the setup page is up. If exactly
  // one Noor server announces itself, use it: it's this home's server, perhaps at a new address.
  // With several, the setup page lists them to choose from. A short wait lets others answer too.
  private void maybeUseFound() {
    if (!onSetup || !"offline".equals(setupReason) || finder.only() == null) return;
    handler.removeCallbacks(useFound);
    handler.postDelayed(useFound, 3000);
  }
  private final Runnable useFound = new Runnable() {
    @Override public void run() {
      String url = finder.only();
      if (!onSetup || !"offline".equals(setupReason) || url == null) return;
      Log.i(TAG, "Using the Noor server found on the network: " + url);
      Server.save(MainActivity.this, url, false);
      showDashboard();
    }
  };

  // The dashboard from the saved server. With no server yet, the setup page looks for one.
  private void showDashboard() {
    String url = serverUrl();
    if (Server.origin(url) == null) {
      showSetup("offline");
      return;
    }
    onSetup = false;
    Log.i(TAG, "Loading " + url);
    web.loadUrl(url);
  }

  private void showSetup(String reason) {
    setupReason = reason;
    onSetup = true;
    finder.start();
    Log.i(TAG, "Showing Wi-Fi setup (" + reason + ")");
    web.loadUrl(SETUP_URL);
    maybeUseFound();
  }

  // Home pressed, or a new address set over USB: show the dashboard again. Addresses inside
  // intents are never used here (see SetServerActivity).
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    showDashboard();
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
        @Override public void run() { showDashboard(); }
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
      url = Server.normalize(url);
      if (url == null) return false;
      Server.save(MainActivity.this, url, true);
      Log.i(TAG, "Server address set to " + url);
      return true;
    }

    // Noor servers announcing themselves on this network: [{"name", "url"}, …].
    @JavascriptInterface
    public String servers() { return finder.json(); }

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
