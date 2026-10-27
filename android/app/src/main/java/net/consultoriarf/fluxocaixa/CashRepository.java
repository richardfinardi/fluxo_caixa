package net.consultoriarf.fluxocaixa;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.TypedValue;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public final class CashRepository {
    private static final String API = "https://script.google.com/macros/s/AKfycbyPGpW6_YUbWEKYBvEPok8VISZxgCxBNqh2yTwqSM4MjjgpRycyuLusZ62PzDZVzZgHiw/exec";
    private static final String PREFS = "cash_widget_summary";
    private static final Locale BR = new Locale("pt", "BR");

    private CashRepository() {}

    public static void refreshAsync(Context context) {
        Context app = context.getApplicationContext();
        new Thread(() -> refresh(app), "rf-cash-refresh").start();
    }

    public static void refresh(Context context) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(API).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestMethod("GET");
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != 200) throw new IllegalStateException("HTTP " + conn.getResponseCode());
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            try (InputStream in = conn.getInputStream()) {
                byte[] bytes = new byte[8192];
                int length;
                while ((length = in.read(bytes)) != -1) {
                    buffer.write(bytes, 0, length);
                    if (buffer.size() > 12 * 1024 * 1024) throw new IllegalStateException("Resposta acima do limite");
                }
            }
            JSONObject data = new JSONObject(buffer.toString("UTF-8"));
            JSONArray rows = data.optJSONArray("lancamentos");
            if (rows == null || data.has("erro")) throw new IllegalStateException("Resposta inválida");
            Summary summary = calculate(rows);
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString("saldo", money(summary.saldo))
                    .putString("receber", money(summary.receber))
                    .putString("pagar", money(summary.pagar))
                    .putLong("atualizado", System.currentTimeMillis())
                    .apply();
        } catch (Exception ignored) {
            // Preserva último resumo do widget caso Google esteja indisponível.
        } finally {
            if (conn != null) conn.disconnect();
            showCached(context);
        }
    }

    private static final class Summary {
        double saldo;
        double receber;
        double pagar;
    }

    private static Summary calculate(JSONArray rows) {
        Summary s = new Summary();
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        for (int i = 0; i < rows.length(); i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            String status = r.optString("status", "Projetado").trim().toLowerCase(BR);
            if (status.equals("pago no cartao") || status.equals("pago no cartão")) continue;
            String date = r.optString("data", "");
            if (date.length() < 10 || date.compareTo(today) > 0) continue;
            double value = Math.abs(r.optDouble("valor", 0));
            boolean income = r.optString("tipo", "").equalsIgnoreCase("Receita");
            if (status.equals("consolidado")) {
                s.saldo += income ? value : -value;
            } else if (income) {
                s.receber += value;
            } else {
                s.pagar += value;
            }
        }
        return s;
    }

    private static String money(double amount) {
        return NumberFormat.getCurrencyInstance(BR).format(amount);
    }

    public static void showCached(Context context) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, CashWidget.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids == null || ids.length == 0) return;

        long timestamp = p.getLong("atualizado", 0);
        String label = timestamp == 0 ? "Toque em ↻ para sincronizar" :
                "Atual. " + new SimpleDateFormat("dd/MM HH:mm", BR).format(new Date(timestamp));
        if (timestamp > 0 && System.currentTimeMillis() - timestamp > 60L * 60L * 1000L)
            label += " · antigo";

        Intent openIntent = new Intent(context, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent open = PendingIntent.getActivity(context, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent refreshIntent = new Intent(context, CashWidget.class);
        refreshIntent.setAction(CashWidget.ACTION_REFRESH);
        PendingIntent refresh = PendingIntent.getBroadcast(context, 1, refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        for (int id : ids) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_cash);
            String balance = p.getString("saldo", "—");
            v.setTextViewText(R.id.widgetSaldo, balance);
            v.setTextViewTextSize(R.id.widgetSaldo, TypedValue.COMPLEX_UNIT_SP,
                    balance.length() > 15 ? 15 : balance.length() > 12 ? 17 : 20);
            v.setTextViewText(R.id.widgetReceber, p.getString("receber", "—"));
            v.setTextViewText(R.id.widgetPagar, p.getString("pagar", "—"));
            v.setTextViewText(R.id.widgetUpdated, label);
            v.setOnClickPendingIntent(R.id.widgetRefresh, refresh);
            v.setOnClickPendingIntent(R.id.widgetBody, open);
            manager.updateAppWidget(id, v);
        }
    }
}
