package net.consultoriarf.fluxocaixa;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String SITE = "https://richardfinardi.github.io/fluxo_caixa/";
    private static final int FILE_REQUEST = 501;
    private WebView web;
    private TextView offline;
    private ValueCallback<Uri[]> uploadCallback;

    private int dp(float value) {
        return (int)(value * getResources().getDisplayMetrics().density + 0.5f);
    }

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(21, 32, 51));
        getWindow().setNavigationBarColor(Color.rgb(21, 32, 51));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        setContentView(root);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), 0, dp(8), 0);
        header.setBackgroundColor(Color.rgb(30, 44, 66));
        root.addView(header, new LinearLayout.LayoutParams(-1, dp(46)));

        TextView title = new TextView(this);
        title.setText("FLUXO DE CAIXA");
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setTypeface(null, 1);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));

        Button home = toolbarButton("⌂");
        header.addView(home, new LinearLayout.LayoutParams(dp(42), dp(42)));
        home.setOnClickListener(v -> web.loadUrl(SITE));

        Button refresh = toolbarButton("↻");
        header.addView(refresh, new LinearLayout.LayoutParams(dp(42), dp(42)));
        refresh.setOnClickListener(v -> {
            offline.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            web.reload();
            CashRepository.refreshAsync(getApplicationContext());
        });

        FrameLayout page = new FrameLayout(this);
        root.addView(page, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this);
        page.addView(web, new FrameLayout.LayoutParams(-1, -1));
        offline = new TextView(this);
        offline.setText("Não foi possível abrir o fluxo de caixa.\nVerifique sua conexão e toque em ↻.");
        offline.setTextColor(Color.rgb(45, 55, 72));
        offline.setGravity(Gravity.CENTER);
        offline.setPadding(dp(28), dp(20), dp(28), dp(20));
        offline.setVisibility(View.GONE);
        page.addView(offline, new FrameLayout.LayoutParams(-1, -1));

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(SITE)) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                offline.setVisibility(View.GONE);
                web.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    offline.setVisibility(View.VISIBLE);
                    web.setVisibility(View.GONE);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (uploadCallback != null) uploadCallback.onReceiveValue(null);
                uploadCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    uploadCallback = null;
                    Toast.makeText(MainActivity.this, "Seletor de arquivos indisponível", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> openExternal(url));
        if (state == null || web.restoreState(state) == null) web.loadUrl(SITE);
        RefreshService.schedule(this);
        CashRepository.showCached(this);
        CashRepository.refreshAsync(getApplicationContext());
    }

    private Button toolbarButton(String label) {
        Button button = new Button(this);
        button.setAllCaps(false);
        button.setText(label);
        button.setTextSize(22);
        button.setTextColor(Color.WHITE);
        button.setPadding(0, 0, 0, 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private void openExternal(String url) {
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(this, "Não foi possível abrir o link", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && uploadCallback != null) {
            uploadCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            uploadCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
