import { createServerFn } from "@tanstack/react-start";

export type Branding = {
  system_name: string; short_name: string; login_title: string; welcome_message: string; login_instructions: string;
  footer: string; support_text: string; accent_color: string; logo_url: string | null; favicon_url: string | null; login_image_url: string | null;
  teacher_login_button: string; student_login_button: string; setup_button: string;
  default_language: string; enabled_languages: string[];
};

export const getBranding = createServerFn({ method: "GET" }).handler(async (): Promise<Branding> => {
  const { publicClient } = await import("./security.server");
  const { data } = await publicClient().from("system_settings").select("key, value").in("key", ["branding", "interface"]).eq("is_public", true);
  const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value as Record<string, unknown>]));
  return {
    system_name: "Learning Platform", short_name: "", login_title: "", welcome_message: "", login_instructions: "",
    footer: "", support_text: "", accent_color: "#1f5fbf", logo_url: null, favicon_url: null, login_image_url: null,
    teacher_login_button: "", student_login_button: "", setup_button: "",
    ...(map["branding"] as object),
    default_language: String(map["interface"]?.["default_language"] ?? "az"),
    enabled_languages: Array.isArray(map["interface"]?.["enabled_languages"])
      ? (map["interface"]!["enabled_languages"] as unknown[])
          .filter((value): value is string => typeof value === "string")
      : ["az", "en", "ru", "tr"],
  } as Branding;
});
