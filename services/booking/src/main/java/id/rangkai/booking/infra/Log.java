package id.rangkai.booking.infra;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** Log JSON satu baris dengan format yang sama seperti service Node. Selalu melewati Masking. */
public final class Log {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SERVICE = System.getenv().getOrDefault("INSTANCE_ID", "booking");

    private Log() {}

    public static void info(String msg, Object... kv) { write("info", msg, kv); }
    public static void warn(String msg, Object... kv) { write("warn", msg, kv); }
    public static void error(String msg, Object... kv) { write("error", msg, kv); }

    private static void write(String level, String msg, Object[] kv) {
        Map<String, Object> line = new LinkedHashMap<>();
        line.put("ts", Instant.now().toString());
        line.put("level", level);
        line.put("service", SERVICE);
        line.put("msg", Masking.mask(msg));
        for (int i = 0; i + 1 < kv.length; i += 2) {
            line.put(String.valueOf(kv[i]), kv[i + 1] instanceof String s ? Masking.mask(s) : kv[i + 1]);
        }
        try {
            System.out.println(JSON.writeValueAsString(line));
        } catch (JsonProcessingException e) {
            System.out.println("{\"level\":\"error\",\"msg\":\"gagal menulis log\"}");
        }
    }
}
