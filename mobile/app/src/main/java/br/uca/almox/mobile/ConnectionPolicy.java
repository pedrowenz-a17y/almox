package br.uca.almox.mobile;

import java.net.URI;
import java.util.Locale;

/** Shared by native UI, navigation, camera and the origin-bound message channel. */
public final class ConnectionPolicy {
    public static final int MAX_DOWNLOAD = 10 * 1024 * 1024;
    private ConnectionPolicy() {}

    public static String origin(String text) {
        try {
            URI url = new URI(text.trim());
            String host = url.getHost();
            if (!"https".equalsIgnoreCase(url.getScheme()) || host == null || url.getRawUserInfo() != null ||
                url.getRawQuery() != null || url.getRawFragment() != null ||
                !(url.getPath().isEmpty() || "/".equals(url.getPath()))) throw new IllegalArgumentException();
            host = host.toLowerCase(Locale.ROOT);
            if (!host.contains(".") || host.matches("[0-9.]+") || host.endsWith(".local") || host.endsWith(".localhost") ||
                host.contains(":") || host.endsWith(".") || url.getPort() == 0 || url.getPort() > 65535) throw new IllegalArgumentException();
            int port = url.getPort() == 443 ? -1 : url.getPort();
            return new URI("https", null, host, port, null, null, null).toString();
        } catch (Exception error) {
            throw new IllegalArgumentException("Use o endereço HTTPS do ERP publicado, sem /login. Localhost aponta para o próprio celular.");
        }
    }

    public static boolean sameOrigin(String value, String trusted) {
        if (trusted == null || value == null) return false;
        try {
            URI url = new URI(value);
            if (url.getHost() == null || url.getRawUserInfo() != null) return false;
            URI base = new URI(url.getScheme(), null, url.getHost(), url.getPort(), null, null, null);
            return origin(base.toString()).equals(trusted);
        } catch (Exception ignored) { return false; }
    }

    public static boolean videoOnly(String[] resources) {
        return resources != null && resources.length == 1 && "android.webkit.resource.VIDEO_CAPTURE".equals(resources[0]);
    }

    public static String mime(String value) {
        String type = value == null ? "" : value.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return switch (type) {
            case "text/csv", "application/pdf", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                 "image/png", "image/jpeg", "image/webp" -> type;
            default -> throw new IllegalArgumentException("Este formato não é um relatório ou uma imagem do Almox.");
        };
    }

    public static String filename(String value, String type) {
        String name = value == null ? "arquivo" : value.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[^\\p{L}\\p{N}._ -]", "_");
        name = name.replaceAll("^[. ]+", "").trim();
        if (name.isEmpty()) name = "arquivo";
        if (name.length() > 100) name = name.substring(0, 100);
        String extension = switch (mime(type)) {
            case "text/csv" -> ".csv";
            case "application/pdf" -> ".pdf";
            case "application/vnd.ms-excel" -> ".xls";
            case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" -> ".xlsx";
            case "image/jpeg" -> ".jpg";
            case "image/webp" -> ".webp";
            default -> ".png";
        };
        if (!name.toLowerCase(Locale.ROOT).endsWith(extension)) name += extension;
        return name;
    }
}
