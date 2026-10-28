package net.consultoriarf.fluxocaixa;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class NativeBackend {
    private static final String API = "https://script.google.com/macros/s/AKfycbyPGpW6_YUbWEKYBvEPok8VISZxgCxBNqh2yTwqSM4MjjgpRycyuLusZ62PzDZVzZgHiw/exec";
    private static final String CACHE = "native_flow_cache";
    private NativeBackend() {}

    public static JSONObject cached(Context context) {
        String source = context.getSharedPreferences(CACHE, Context.MODE_PRIVATE).getString("data", "");
        try {
            JSONObject data = new JSONObject(source);
            if (data.has("lancamentos")) return data;
        } catch (Exception ignored) { }
        return null;
    }

    public static void save(Context context, JSONObject data) {
        if (data != null && data.has("lancamentos")) {
            context.getSharedPreferences(CACHE, Context.MODE_PRIVATE)
                    .edit().putString("data", data.toString()).apply();
        }
    }

    public static Object call(String function, Object args, boolean write) throws Exception {
        if (function == null || function.isEmpty()) return get();
        JSONObject request = new JSONObject();
        request.put("funcao", function);
        if (args != null) request.put("args", args);
        if (write) request.put("retornarDados", true);
        return execute("POST", request.toString());
    }

    public static JSONObject get() throws Exception {
        Object response = execute("GET", null);
        if (!(response instanceof JSONObject) || !((JSONObject)response).has("lancamentos"))
            throw new IllegalStateException("A API não devolveu lançamentos.");
        return (JSONObject)response;
    }

    private static Object execute(String method, String body) throws Exception {
        URL url = new URL(API);
        for (int redirect = 0; redirect < 6; redirect++) {
            HttpURLConnection connection = (HttpURLConnection)url.openConnection();
            try {
                connection.setRequestMethod(method);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(35000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                if (body != null) {
                    connection.setDoOutput(true);
                    connection.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
                    try (OutputStream output = connection.getOutputStream()) {
                        output.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                }
                int http = connection.getResponseCode();
                if (http >= 300 && http < 400) {
                    String next = connection.getHeaderField("Location");
                    if (next == null || !next.startsWith("https://"))
                        throw new IllegalStateException("Redirecionamento inválido");
                    url = new URL(next);
                    // Redirect pós-POST no Apps Script aponta para o resultado JSON (GET).
                    if (http == 303 || http == 302 || http == 301) {
                        method = "GET";
                        body = null;
                    }
                    continue;
                }
                if (http < 200 || http >= 300)
                    throw new IllegalStateException("API HTTP " + http);
                try (InputStream input = connection.getInputStream();
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] bytes = new byte[8192];
                    int length;
                    while ((length = input.read(bytes)) >= 0) {
                        output.write(bytes, 0, length);
                        if (output.size() > 14_000_000)
                            throw new IllegalStateException("Resposta acima do limite.");
                    }
                    String raw = output.toString("UTF-8").trim();
                    if (raw.startsWith("{")) {
                        JSONObject parsed = new JSONObject(raw);
                        if (parsed.has("erro")) throw new IllegalStateException(parsed.optString("erro"));
                        return parsed;
                    }
                    if (raw.startsWith("[")) return new JSONArray(raw);
                    if (raw.startsWith("<"))
                        throw new IllegalStateException("API retornou HTML. Verifique a publicação do Apps Script.");
                    return raw.replace("\"", "");
                }
            } finally {
                connection.disconnect();
            }
        }
        throw new IllegalStateException("Muitos redirecionamentos.");
    }
}
