package com.customerapp;

import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;

    // CHANGE THIS to your Render URL
    private static final String APP_URL = "https://customer-app-ohm2.onrender.com";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // BLOCK SCREENSHOTS AND SCREEN RECORDING — OS level, cannot be bypassed
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);

        setContentView(R.layout.activity_main);

        swipeRefresh = findViewById(R.id.swipe_refresh);
        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // Clear all caches
        webView.clearCache(true);
        webView.clearHistory();
        webView.clearFormData();
        CookieManager.getInstance().removeAllCookies(null);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().flush();
        }
        WebStorage.getInstance().deleteAllData();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                swipeRefresh.setRefreshing(false);
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        // First load a local page that clears ALL web storage, then redirects to the app
        String clearScript =
            "<!DOCTYPE html>" +
            "<html><body><script>" +
            "localStorage.clear();" +
            "sessionStorage.clear();" +
            "window.location.href = '" + APP_URL + "';" +
            "</script></body></html>";

        webView.loadDataWithBaseURL(APP_URL, clearScript, "text/html", "UTF-8", null);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
