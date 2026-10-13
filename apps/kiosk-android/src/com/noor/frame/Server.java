package com.noor.frame;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;
import java.net.Inet4Address;
import java.net.URI;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

// Where the Noor server is: the saved address, and Noor servers announcing themselves on the
// home network (_noor-frame._tcp, the same announcement the Raspberry Pi screens look for).
final class Server {
  static final String SERVICE = "_noor-frame._tcp";
  // The file Android's getPreferences() used for MainActivity, so addresses saved by older
  // versions are kept.
  private static final String PREFS = "MainActivity";

  private Server() {}

  private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

  // The saved address, or "" when none has been set or found yet.
  static String saved(Context c) { return prefs(c).getString("url", ""); }

  static void save(Context c, String url, boolean byHand) {
    prefs(c).edit().putString("url", url).putBoolean("byHand", byHand).apply();
  }

  // "192.168.1.20:8787" or "http://noor.local:8787/x" → "http://host:port/…", or null when it
  // isn't an http(s) address with a host.
  static String normalize(String url) {
    url = url == null ? "" : url.trim();
    if (url.isEmpty()) return null;
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
    if (!url.matches("https?://[^/\\s]+(/\\S*)?")) return null;
    if (!url.substring(url.indexOf("//") + 2).contains("/")) url += "/";
    return origin(url) == null ? null : url;
  }

  // "http://host:port" for an http(s) address, or null.
  static String origin(String url) {
    try {
      URI u = new URI(url);
      String scheme = u.getScheme();
      if (scheme == null || u.getHost() == null || u.getUserInfo() != null) return null;
      scheme = scheme.toLowerCase();
      if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
      int port = u.getPort() == -1 ? ("https".equals(scheme) ? 443 : 80) : u.getPort();
      return scheme + "://" + u.getHost().toLowerCase() + ":" + port;
    } catch (Exception e) {
      return null;
    }
  }

  static boolean sameOrigin(String a, String b) {
    String oa = origin(a);
    return oa != null && oa.equals(origin(b));
  }

  // Looks for Noor servers on the network while it runs. Android resolves one service at a
  // time, so found services wait their turn.
  static final class Finder {
    interface Listener { void changed(); }

    private final NsdManager nsd;
    private final Listener listener;
    private final Map<String, String> found = new LinkedHashMap<String, String>();
    private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<NsdServiceInfo>();
    private boolean resolving, running;

    Finder(Context c, Listener listener) {
      this.nsd = (NsdManager) c.getApplicationContext().getSystemService(Context.NSD_SERVICE);
      this.listener = listener;
    }

    synchronized void start() {
      if (running || nsd == null) return;
      running = true;
      try {
        nsd.discoverServices(SERVICE, NsdManager.PROTOCOL_DNS_SD, discovery);
        Log.i(MainActivity.TAG, "Looking for Noor servers on the network");
      } catch (Exception e) {
        running = false;
        Log.w(MainActivity.TAG, "Can't look for Noor servers: " + e);
      }
    }

    synchronized void stop() {
      if (!running) return;
      running = false;
      try { nsd.stopServiceDiscovery(discovery); } catch (Exception e) { /* already stopped */ }
    }

    // [{"name": "noor-frame on kitchen-pi", "url": "http://192.168.1.20:8787/"}, …]
    synchronized String json() {
      JSONArray out = new JSONArray();
      try {
        for (Map.Entry<String, String> e : found.entrySet()) {
          out.put(new JSONObject().put("name", e.getKey()).put("url", e.getValue()));
        }
      } catch (Exception e) { /* nothing to add */ }
      return out.toString();
    }

    synchronized int count() { return found.size(); }

    synchronized String only() { return found.size() == 1 ? found.values().iterator().next() : null; }

    private synchronized void next() {
      if (resolving || queue.isEmpty()) return;
      resolving = true;
      nsd.resolveService(queue.poll(), new NsdManager.ResolveListener() {
        @Override public void onServiceResolved(NsdServiceInfo s) {
          boolean added = false;
          synchronized (Finder.this) {
            resolving = false;
            if (s.getHost() instanceof Inet4Address && s.getPort() > 0) {
              String url = "http://" + s.getHost().getHostAddress() + ":" + s.getPort() + "/";
              added = !url.equals(found.put(s.getServiceName(), url));
              if (added) Log.i(MainActivity.TAG, "Found Noor server " + s.getServiceName() + " at " + url);
            }
          }
          if (added) listener.changed();
          next();
        }
        @Override public void onResolveFailed(NsdServiceInfo s, int error) {
          synchronized (Finder.this) { resolving = false; }
          next();
        }
      });
    }

    private final NsdManager.DiscoveryListener discovery = new NsdManager.DiscoveryListener() {
      @Override public void onServiceFound(NsdServiceInfo s) {
        synchronized (Finder.this) { queue.add(s); }
        next();
      }
      // Android reports announcements as lost and found again every so often; a server that
      // really went away just won't answer when it's chosen. So found servers stay listed.
      @Override public void onServiceLost(NsdServiceInfo s) {}
      @Override public void onDiscoveryStarted(String type) {}
      @Override public void onDiscoveryStopped(String type) {}
      @Override public void onStartDiscoveryFailed(String type, int error) {
        synchronized (Finder.this) { running = false; }
        Log.w(MainActivity.TAG, "Looking for Noor servers failed (" + error + ")");
      }
      @Override public void onStopDiscoveryFailed(String type, int error) {}
    };
  }
}
