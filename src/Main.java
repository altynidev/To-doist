import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.awt.Desktop;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.BindException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * To-doist — a personal, fully local productivity hub.
 *
 * Serves the web app from ./web and stores everything in ./data:
 *   data/data.json      all your tasks, notes, goals, habits, vision boards
 *   data/backups/       one automatic snapshot per day (last 30 kept)
 *   data/uploads/       images added to vision boards
 *   data/phone-key.txt  the secret in the phone link (only while phone access is on)
 *   data/gemini-key.txt your Google Gemini API key, if you added one (never sent to the browser)
 *
 * The AI assistant talks to Ollama on this computer, or to Google Gemini; requests go through
 * this server so the Gemini key stays here.
 *
 * The computer itself always has access. Other devices on the network (your phone) are
 * refused unless phone access is turned on in Settings and they opened the secret link.
 */
public class Main {
    static final int PORT = Integer.parseInt(System.getenv().getOrDefault("TODOIST_PORT", "4321"));
    static final Path ROOT = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
    static final Path WEB_DIR = ROOT.resolve("web");
    static final Path DATA_DIR = ROOT.resolve("data");
    static final Path DATA_FILE = DATA_DIR.resolve("data.json");
    static final Path BACKUP_DIR = DATA_DIR.resolve("backups");
    static final Path UPLOAD_DIR = DATA_DIR.resolve("uploads");
    static final Path PHONE_KEY_FILE = DATA_DIR.resolve("phone-key.txt");
    static final Path GEMINI_KEY_FILE = DATA_DIR.resolve("gemini-key.txt");
    static final String OLLAMA_URL = "http://127.0.0.1:11434/api/";
    static final String GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
    static final Pattern MODEL_NAME = Pattern.compile("[A-Za-z0-9._:\\-/]{1,100}");
    static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    static final String KEY_COOKIE = "todoist_key";
    // Needed before a phone has the key: browsers fetch these without cookies.
    static final List<String> PUBLIC_PATHS = List.of("/manifest.webmanifest", "/favicon.svg",
            "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png");

    static final int MAX_DATA_BYTES = 50 * 1024 * 1024;
    static final int MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
    static final int BACKUPS_TO_KEEP = 30;

    static final List<String> IMAGE_EXTS = List.of("png", "jpg", "jpeg", "gif", "webp");
    static final Pattern UPLOAD_NAME = Pattern.compile("[0-9a-f\\-]{36}\\.(png|jpg|jpeg|gif|webp)");

    static final Map<String, String> MIME = Map.ofEntries(
            Map.entry("html", "text/html; charset=utf-8"),
            Map.entry("css", "text/css; charset=utf-8"),
            Map.entry("js", "text/javascript; charset=utf-8"),
            Map.entry("json", "application/json; charset=utf-8"),
            Map.entry("webmanifest", "application/manifest+json; charset=utf-8"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("png", "image/png"),
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("gif", "image/gif"),
            Map.entry("webp", "image/webp"),
            Map.entry("ico", "image/x-icon")
    );

    /** Secret that phones must present; null while phone access is off. */
    static volatile String phoneKey;
    /** Bumped on every save, so a device editing an outdated copy can't overwrite newer data. */
    static long revision = System.currentTimeMillis();

    public static void main(String[] args) throws IOException {
        boolean openBrowser = !List.of(args).contains("--no-browser");
        String url = "http://localhost:" + PORT;

        if (!Files.isDirectory(WEB_DIR)) {
            System.err.println("Could not find the 'web' folder in " + ROOT);
            System.err.println("Run the app from the project folder (the one containing 'web' and 'src').");
            System.exit(1);
        }
        Files.createDirectories(BACKUP_DIR);
        Files.createDirectories(UPLOAD_DIR);
        if (Files.exists(PHONE_KEY_FILE)) phoneKey = Files.readString(PHONE_KEY_FILE).strip();

        HttpServer server;
        try {
            server = HttpServer.create(new InetSocketAddress(PORT), 0);
        } catch (BindException e) {
            System.out.println("Port " + PORT + " is already in use — To-doist is probably already running.");
            System.out.println("Open " + url + " in your browser.");
            if (openBrowser) openInBrowser(url);
            return;
        }

        server.createContext("/api/data", ex -> safely(ex, Main::handleData));
        server.createContext("/api/rev", ex -> safely(ex, Main::handleRev));
        server.createContext("/api/upload", ex -> safely(ex, Main::handleUpload));
        server.createContext("/api/phone", ex -> safely(ex, Main::handlePhone));
        server.createContext("/api/ai/", ex -> safely(ex, Main::handleAi));
        server.createContext("/", ex -> safely(ex, Main::handleStatic));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();

        System.out.println("To-doist is running at " + url);
        System.out.println("Your data is saved in " + DATA_FILE);
        if (phoneKey != null) {
            System.out.println("Phone access is on: scan the QR code in Settings with your phone.");
        }
        System.out.println("Press Ctrl+C (or stop the run in IntelliJ) to quit.");
        if (openBrowser) openInBrowser(url);
    }

    // ---- API: whole-app state ------------------------------------------------

    static void handleData(HttpExchange ex) throws IOException {
        switch (ex.getRequestMethod()) {
            case "GET" -> sendCurrentData(ex, 200);
            // POST is accepted too so the page can use navigator.sendBeacon when closing.
            case "PUT", "POST" -> {
                byte[] body = readBody(ex, MAX_DATA_BYTES);
                if (body == null) {
                    sendText(ex, 413, "Data too large");
                    return;
                }
                String text = new String(body, StandardCharsets.UTF_8).strip();
                if (!text.startsWith("{") || !text.endsWith("}")) {
                    sendText(ex, 400, "Expected a JSON object");
                    return;
                }
                long newRev = saveData(body, queryParam(ex.getRequestURI().getQuery(), "rev"));
                if (newRev < 0) {
                    // Another device saved in between: send back the newer data instead.
                    sendCurrentData(ex, 409);
                    return;
                }
                send(ex, 200, MIME.get("json"), ("{\"ok\":true,\"rev\":" + newRev + "}").getBytes(StandardCharsets.UTF_8));
            }
            default -> sendText(ex, 405, "Method not allowed");
        }
    }

    static void handleRev(HttpExchange ex) throws IOException {
        long rev;
        synchronized (Main.class) { rev = revision; }
        send(ex, 200, MIME.get("json"), ("{\"rev\":" + rev + "}").getBytes(StandardCharsets.UTF_8));
    }

    static void sendCurrentData(HttpExchange ex, int status) throws IOException {
        byte[] body;
        long rev;
        synchronized (Main.class) {
            body = Files.exists(DATA_FILE) ? Files.readAllBytes(DATA_FILE) : "null".getBytes(StandardCharsets.UTF_8);
            rev = revision;
        }
        ex.getResponseHeaders().set("X-Rev", Long.toString(rev));
        send(ex, status, MIME.get("json"), body);
    }

    /**
     * Saves the data if it was based on the latest revision (or no revision was given).
     * Returns the new revision, or -1 if the sender's copy was out of date.
     */
    static synchronized long saveData(byte[] body, String baseRev) throws IOException {
        if (!baseRev.isEmpty() && !baseRev.equals(Long.toString(revision))) return -1;
        // Before the first save of each day, snapshot yesterday's state.
        if (Files.exists(DATA_FILE)) {
            Path todaysBackup = BACKUP_DIR.resolve("data-" + LocalDate.now() + ".json");
            if (!Files.exists(todaysBackup)) {
                Files.copy(DATA_FILE, todaysBackup);
                pruneBackups();
            }
        }
        // Write to a temp file and swap it in, so a crash never leaves a half-written file.
        Path tmp = DATA_DIR.resolve("data.json.tmp");
        Files.write(tmp, body);
        try {
            Files.move(tmp, DATA_FILE, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, DATA_FILE, StandardCopyOption.REPLACE_EXISTING);
        }
        return ++revision;
    }

    static void pruneBackups() throws IOException {
        try (Stream<Path> files = Files.list(BACKUP_DIR)) {
            List<Path> backups = files
                    .filter(p -> p.getFileName().toString().matches("data-\\d{4}-\\d{2}-\\d{2}\\.json"))
                    .sorted()
                    .toList();
            for (int i = 0; i < backups.size() - BACKUPS_TO_KEEP; i++) {
                Files.deleteIfExists(backups.get(i));
            }
        }
    }

    // ---- API: vision board images --------------------------------------------

    static void handleUpload(HttpExchange ex) throws IOException {
        String query = ex.getRequestURI().getQuery();
        switch (ex.getRequestMethod()) {
            case "POST" -> {
                String ext = queryParam(query, "ext").toLowerCase();
                if (ext.equals("jpeg")) ext = "jpg";
                if (!IMAGE_EXTS.contains(ext)) {
                    sendText(ex, 400, "Unsupported image type");
                    return;
                }
                byte[] body = readBody(ex, MAX_UPLOAD_BYTES);
                if (body == null) {
                    sendText(ex, 413, "Image too large (max 20 MB)");
                    return;
                }
                String name = UUID.randomUUID() + "." + ext;
                Files.write(UPLOAD_DIR.resolve(name), body);
                String json = "{\"url\":\"/uploads/" + name + "\"}";
                send(ex, 200, MIME.get("json"), json.getBytes(StandardCharsets.UTF_8));
            }
            case "DELETE" -> {
                String name = queryParam(query, "name");
                if (!UPLOAD_NAME.matcher(name).matches()) {
                    sendText(ex, 400, "Bad file name");
                    return;
                }
                Files.deleteIfExists(UPLOAD_DIR.resolve(name));
                send(ex, 200, MIME.get("json"), "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
            }
            default -> sendText(ex, 405, "Method not allowed");
        }
    }

    // ---- API: AI assistant ---------------------------------------------------

    /*
     * GET  /api/ai/ollama/tags              installed local models
     * POST /api/ai/ollama/chat              a chat request, passed to Ollama as is
     * GET  /api/ai/gemini/models            Gemini models available to the key
     * POST /api/ai/gemini/generate?model=   a generateContent request, passed to Gemini with the key
     * GET  /api/ai/key                      {"gemini": true|false}
     * PUT  /api/ai/key                      body = the Gemini key (empty removes it); this computer only
     */
    static void handleAi(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath().substring("/api/ai/".length());
        String method = ex.getRequestMethod();
        String json = MIME.get("json");
        switch (method + " " + path) {
            case "GET ollama/tags" -> forward(ex, HttpRequest.newBuilder(URI.create(OLLAMA_URL + "tags")).GET(), 10, "Ollama");
            case "POST ollama/chat" -> forward(ex, HttpRequest.newBuilder(URI.create(OLLAMA_URL + "chat"))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(readBody(ex, MAX_DATA_BYTES))), 600, "Ollama");
            case "GET gemini/models", "POST gemini/generate" -> {
                String key = Files.exists(GEMINI_KEY_FILE) ? Files.readString(GEMINI_KEY_FILE).strip() : "";
                if (key.isEmpty()) {
                    sendText(ex, 400, "Add your Gemini API key in Settings first.");
                    return;
                }
                HttpRequest.Builder req;
                if (method.equals("GET")) {
                    req = HttpRequest.newBuilder(URI.create(GEMINI_URL + "?pageSize=1000")).GET();
                } else {
                    String model = queryParam(ex.getRequestURI().getQuery(), "model").replaceFirst("^models/", "");
                    if (!MODEL_NAME.matcher(model).matches()) {
                        sendText(ex, 400, "Bad model name");
                        return;
                    }
                    req = HttpRequest.newBuilder(URI.create(GEMINI_URL + "/" + model + ":generateContent"))
                            .POST(HttpRequest.BodyPublishers.ofByteArray(readBody(ex, MAX_DATA_BYTES)));
                }
                forward(ex, req.header("x-goog-api-key", key), 180, "Google Gemini");
            }
            case "GET key" -> send(ex, 200, json,
                    ("{\"gemini\":" + Files.exists(GEMINI_KEY_FILE) + "}").getBytes(StandardCharsets.UTF_8));
            case "PUT key" -> {
                if (!isLocal(ex)) {
                    sendText(ex, 403, "The key can only be changed on the computer running To-doist");
                    return;
                }
                String key = new String(readBody(ex, 1000), StandardCharsets.UTF_8).strip();
                if (key.isEmpty()) Files.deleteIfExists(GEMINI_KEY_FILE);
                else Files.writeString(GEMINI_KEY_FILE, key);
                send(ex, 200, json, "{\"ok\":true}".getBytes(StandardCharsets.UTF_8));
            }
            default -> sendText(ex, 404, "Not found");
        }
    }

    /** Sends the request on and relays the answer (status and body) back to the browser. */
    static void forward(HttpExchange ex, HttpRequest.Builder req, int timeoutSeconds, String service) throws IOException {
        HttpResponse<byte[]> res;
        try {
            res = HTTP.send(req.header("Content-Type", "application/json")
                    .timeout(Duration.ofSeconds(timeoutSeconds)).build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (java.net.ConnectException e) {
            sendText(ex, 503, service.equals("Ollama")
                    ? "Ollama isn't running. Start the Ollama app on this computer."
                    : "Couldn't reach " + service + ". Check the internet connection.");
            return;
        } catch (java.net.http.HttpTimeoutException e) {
            sendText(ex, 504, service + " took too long to answer.");
            return;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            sendText(ex, 503, "Interrupted");
            return;
        }
        String type = res.headers().firstValue("Content-Type").orElse(MIME.get("json"));
        send(ex, res.statusCode(), type, res.body());
    }

    // ---- API: phone access (only from this computer) -------------------------

    static void handlePhone(HttpExchange ex) throws IOException {
        if (!isLocal(ex)) {
            sendText(ex, 403, "Phone access can only be changed on the computer running To-doist");
            return;
        }
        if (ex.getRequestMethod().equals("POST")) {
            switch (queryParam(ex.getRequestURI().getQuery(), "action")) {
                case "on" -> { if (phoneKey == null) setPhoneKey(newKey()); }
                case "reset" -> setPhoneKey(newKey());
                case "off" -> setPhoneKey(null);
                default -> {
                    sendText(ex, 400, "Unknown action");
                    return;
                }
            }
        } else if (!ex.getRequestMethod().equals("GET")) {
            sendText(ex, 405, "Method not allowed");
            return;
        }
        String key = phoneKey;
        String addresses = String.join(",", lanAddresses().stream().map(a -> "\"" + a + "\"").toList());
        String json = "{\"enabled\":" + (key != null) + ",\"port\":" + PORT
                + ",\"key\":" + (key == null ? "null" : "\"" + key + "\"") + ",\"addresses\":[" + addresses + "]}";
        send(ex, 200, MIME.get("json"), json.getBytes(StandardCharsets.UTF_8));
    }

    static String newKey() {
        byte[] bytes = new byte[16];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    static synchronized void setPhoneKey(String key) throws IOException {
        if (key == null) Files.deleteIfExists(PHONE_KEY_FILE);
        else Files.writeString(PHONE_KEY_FILE, key);
        phoneKey = key;
    }

    /** This computer's addresses on the local network, home-router style (192.168.x.x) first. */
    static List<String> lanAddresses() throws IOException {
        List<String> out = new ArrayList<>();
        for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
            // Adapters for virtual machines / WSL can't be reached from a phone.
            String name = (ni.getDisplayName() + " " + ni.getName()).toLowerCase();
            if (Stream.of("vethernet", "hyper-v", "wsl", "virtualbox", "vmware", "docker").anyMatch(name::contains)) continue;
            for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.add(a.getHostAddress());
            }
        }
        out.sort(Comparator.comparingInt(a -> a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : 2));
        return out;
    }

    // ---- Access control ------------------------------------------------------

    static boolean isLocal(HttpExchange ex) {
        return ex.getRemoteAddress().getAddress().isLoopbackAddress();
    }

    /** Decides whether a request may go ahead; if not, sends the refusal itself. */
    static boolean admit(HttpExchange ex) throws IOException {
        var headers = ex.getRequestHeaders();
        String host = headers.getFirst("Host") == null ? "" : headers.getFirst("Host");

        // Stop other websites open in the same browser from changing your data.
        String origin = headers.getFirst("Origin");
        if (origin != null && !ex.getRequestMethod().equals("GET") && !origin.equals("http://" + host)) {
            sendText(ex, 403, "Cross-site request refused");
            return false;
        }

        if (isLocal(ex)) {
            // A page on a made-up domain pointing at 127.0.0.1 must not get in either.
            String hostName = host.replaceFirst(":\\d+$", "");
            if (!List.of("localhost", "127.0.0.1", "[::1]").contains(hostName)) {
                sendText(ex, 403, "Open To-doist at http://localhost:" + PORT);
                return false;
            }
            return true;
        }

        if (PUBLIC_PATHS.contains(ex.getRequestURI().getPath())) return true;
        String key = phoneKey;
        if (key == null) {
            sendNotice(ex, "Phone access is turned off",
                    "Turn it on in To-doist → Settings on your computer, then scan the QR code shown there.");
            return false;
        }
        String given = queryParam(ex.getRequestURI().getQuery(), "key");
        if (!given.isEmpty()) {
            if (!sameSecret(given, key)) {
                sendNotice(ex, "This link no longer works",
                        "A new phone link was made. Scan the QR code in To-doist → Settings on your computer.");
                return false;
            }
            ex.getResponseHeaders().add("Set-Cookie",
                    KEY_COOKIE + "=" + key + "; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax");
            return true;
        }
        if (sameSecret(cookie(ex, KEY_COOKIE), key)) return true;
        sendNotice(ex, "Open the phone link first", "Scan the QR code in To-doist → Settings on your computer.");
        return false;
    }

    static boolean sameSecret(String a, String b) {
        return a != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    static String cookie(HttpExchange ex, String name) {
        for (String header : ex.getRequestHeaders().getOrDefault("Cookie", List.of())) {
            for (String part : header.split(";")) {
                String p = part.strip();
                if (p.startsWith(name + "=")) return p.substring(name.length() + 1);
            }
        }
        return null;
    }

    static void sendNotice(HttpExchange ex, String title, String text) throws IOException {
        String html = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<title>To-doist</title><body style='font:16px system-ui;background:#f6f1ea;color:#3b322b;"
                + "padding:40px 24px;max-width:480px;margin:auto'><h2 style='font-family:Georgia,serif'>" + title
                + "</h2><p style='color:#76695e'>" + text + "</p>";
        send(ex, 403, MIME.get("html"), html.getBytes(StandardCharsets.UTF_8));
    }

    // ---- Static files --------------------------------------------------------

    static void handleStatic(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("GET")) {
            sendText(ex, 405, "Method not allowed");
            return;
        }
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";

        Path base = WEB_DIR;
        String relative = path.substring(1);
        if (path.startsWith("/uploads/")) {
            base = UPLOAD_DIR;
            relative = path.substring("/uploads/".length());
        }
        Path file = base.resolve(relative).normalize();
        if (!file.startsWith(base) || !Files.isRegularFile(file)) {
            sendText(ex, 404, "Not found");
            return;
        }
        String name = file.getFileName().toString();
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
        send(ex, 200, MIME.getOrDefault(ext, "application/octet-stream"), Files.readAllBytes(file));
    }

    // ---- Helpers -------------------------------------------------------------

    interface Handler {
        void handle(HttpExchange ex) throws IOException;
    }

    static void safely(HttpExchange ex, Handler handler) {
        try (ex) {
            if (admit(ex)) handler.handle(ex);
        } catch (Exception e) {
            System.err.println("Request failed: " + ex.getRequestURI() + " — " + e);
            try {
                sendText(ex, 500, "Server error: " + e.getMessage());
            } catch (IOException ignored) {
                // response already started
            }
        }
    }

    /** Reads the request body, or returns null if it is larger than {@code limit}. */
    static byte[] readBody(HttpExchange ex, int limit) throws IOException {
        try (InputStream in = ex.getRequestBody()) {
            byte[] body = in.readNBytes(limit + 1);
            return body.length > limit ? null : body;
        }
    }

    static String queryParam(String query, String key) {
        if (query == null) return "";
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(key)) return pair.substring(eq + 1);
        }
        return "";
    }

    static void sendText(HttpExchange ex, int status, String text) throws IOException {
        send(ex, status, "text/plain; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
    }

    static void send(HttpExchange ex, int status, String contentType, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.getResponseHeaders().set("Cache-Control", "no-cache");
        ex.sendResponseHeaders(status, body.length == 0 ? -1 : body.length);
        if (body.length > 0) {
            try (OutputStream out = ex.getResponseBody()) {
                out.write(body);
            }
        }
    }

    static void openInBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
            }
        } catch (Exception e) {
            System.out.println("Open " + url + " in your browser.");
        }
    }
}
