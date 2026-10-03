import { ImageResponse } from "next/og";
import { site } from "@/config/site";

export const alt = "nightglass — know what is worth observing tonight, and why";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OpenGraph card, drawn in the same copperplate language as the application:
 * verdigris ground, brass rules, an altitude band with an obstruction line.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0b2b2a",
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(192,138,46,0.08) 0px, rgba(192,138,46,0.08) 1px, transparent 1px, transparent 34px)",
          padding: 64,
          color: "#e9e0cc",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 10, height: 10, backgroundColor: "#c08a2e" }} />
          <div style={{ fontSize: 22, letterSpacing: 8, textTransform: "uppercase", color: "#d8a544" }}>
            Observatory
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 92, lineHeight: 1.02, letterSpacing: -2, color: "#f3ecdb" }}>
            Know what is worth
          </div>
          <div style={{ fontSize: 92, lineHeight: 1.02, letterSpacing: -2, color: "#f3ecdb" }}>
            observing tonight.
          </div>
        </div>

        {/* An altitude band with the obstruction line, drawn from the product's own vocabulary. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              position: "relative",
              height: 74,
              border: "1px solid rgba(192,138,46,0.4)",
              backgroundColor: "rgba(6,26,25,0.5)",
              display: "flex",
            }}
          >
            {[0, 30, 60, 90].map((deg) => (
              <div
                key={deg}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: `${(deg / 90) * 100}%`,
                  borderTop: "1px solid rgba(192,138,46,0.22)",
                }}
              />
            ))}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "22%",
                height: 52,
                backgroundColor: "rgba(184,67,60,0.18)",
                borderTop: "2px solid #b8433c",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "22%",
                height: 2,
                backgroundColor: "#d8a544",
                transform: "rotate(-2deg)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, color: "#b8ab90" }}>
            <span>0°</span>
            <span>ALTITUDE</span>
            <span>90°</span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#d8a544" }}>
          <span>{site.name}</span>
          <span style={{ color: "#b8ab90" }}>github.com/aniruddhaadak80/nightglass</span>
        </div>
      </div>
    ),
    size,
  );
}