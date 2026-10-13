package com.noor.frame;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

// Sets the Noor server's address from a computer over USB:
//
//   adb shell am start -a android.intent.action.VIEW -d http://<server>:8787/ -n com.noor.frame/.SetServerActivity
//
// Only adb can open this (the manifest asks callers for WRITE_SECURE_SETTINGS, which the adb shell
// has and ordinary apps can't get), so no other app on the frame can point Noor somewhere else.
// On the frame itself the address is changed on the Wi-Fi page, or found on the network by itself.
public class SetServerActivity extends Activity {
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    String url = Server.normalize(getIntent() == null ? null : getIntent().getDataString());
    if (url == null) {
      Log.w(MainActivity.TAG, "Ignored a server address that isn't http(s)://host[:port]/");
    } else {
      Server.save(this, url, true);
      Log.i(MainActivity.TAG, "Server address set over USB to " + url);
    }
    startActivity(new Intent(this, MainActivity.class)
        .setAction(MainActivity.RELOAD)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    finish();
  }
}
