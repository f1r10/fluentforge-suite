import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const LANGS = [
  { code: "az", label: "Azərbaycanca" },
  { code: "en", label: "English" },
  { code: "ru", label: "Русский" },
  { code: "tr", label: "Türkçe" },
] as const;
export type Lang = (typeof LANGS)[number]["code"];

type Dict = Record<string, string>;
const en: Dict = {
  access_key: "Access key", sign_in: "Sign in", teacher_sign_in: "Teacher sign in", student_sign_in: "Student sign in",
  username: "Username", password: "Password", forgot_password: "Forgot password?", sign_out: "Sign out",
  dashboard: "Dashboard", students: "Students", groups: "Groups", catalogs: "Catalogs", exams: "Exams", settings: "Settings",
  online_now: "Online now", nobody_online: "Nobody is online right now.", active_today: "Active today",
  pending_reviews: "Answers to review", inbox: "Inbox", questions: "Questions", vocabulary: "Vocabulary",
  recent_activity: "Recent activity", no_activity: "No activity yet.", upcoming_exams: "Exams", recent_catalogs: "Catalogs",
  add_student: "Add student", first_name: "Name", last_name: "Surname", group: "Group", status: "Status", last_active: "Last active",
  active: "Active", disabled: "Disabled", archived: "Archived", all: "All", search: "Search", save: "Save", cancel: "Cancel",
  create: "Create", new_key: "New access key", end_sessions: "End sessions", disable: "Disable", enable: "Enable", archive: "Archive",
  key_once: "Copy this key now. It will not be shown again.", copy: "Copy", copied: "Copied", close: "Close", edit: "Edit",
  members: "Members", add_group: "Add group", name: "Name", description: "Description", delete: "Delete", never: "Never",
  add_catalog: "New catalog", items: "Items", add_exam: "New exam", title: "Title", duration_min: "Duration (minutes)",
  available_from: "Available from", available_until: "Available until", draft: "Draft", scheduled: "Scheduled", finished: "Finished",
  welcome: "Welcome", language: "Language", your_progress: "Your progress", nothing_yet: "Nothing here yet. Your teacher will add lessons soon.",
  edit_student: "Edit student", no_results: "No results.", groups_optional: "Groups (optional)", logged_in: "Signed in",
};
const az: Dict = {
  access_key: "Giriş açarı", sign_in: "Daxil ol", teacher_sign_in: "Müəllim girişi", student_sign_in: "Tələbə girişi",
  username: "İstifadəçi adı", password: "Şifrə", forgot_password: "Şifrəni unutmusunuz?", sign_out: "Çıxış",
  dashboard: "Panel", students: "Tələbələr", groups: "Qruplar", catalogs: "Kataloqlar", exams: "İmtahanlar", settings: "Ayarlar",
  online_now: "İndi onlayn", nobody_online: "Hazırda onlayn heç kim yoxdur.", active_today: "Bu gün aktiv",
  pending_reviews: "Yoxlanılacaq cavablar", inbox: "Gələnlər", questions: "Suallar", vocabulary: "Lüğət",
  recent_activity: "Son fəaliyyət", no_activity: "Hələ fəaliyyət yoxdur.", upcoming_exams: "İmtahanlar", recent_catalogs: "Kataloqlar",
  add_student: "Tələbə əlavə et", first_name: "Ad", last_name: "Soyad", group: "Qrup", status: "Status", last_active: "Son aktivlik",
  active: "Aktiv", disabled: "Deaktiv", archived: "Arxivdə", all: "Hamısı", search: "Axtar", save: "Yadda saxla", cancel: "Ləğv et",
  create: "Yarat", new_key: "Yeni giriş açarı", end_sessions: "Sessiyaları bitir", disable: "Deaktiv et", enable: "Aktiv et", archive: "Arxivlə",
  key_once: "Bu açarı indi kopyalayın. Yenidən göstərilməyəcək.", copy: "Kopyala", copied: "Kopyalandı", close: "Bağla", edit: "Redaktə",
  members: "Üzvlər", add_group: "Qrup əlavə et", name: "Ad", description: "Təsvir", delete: "Sil", never: "Heç vaxt",
  add_catalog: "Yeni kataloq", items: "Elementlər", add_exam: "Yeni imtahan", title: "Başlıq", duration_min: "Müddət (dəqiqə)",
  available_from: "Başlama vaxtı", available_until: "Bitmə vaxtı", draft: "Qaralama", scheduled: "Planlaşdırılıb", finished: "Bitib",
  welcome: "Xoş gəlmisiniz", language: "Dil", your_progress: "İrəliləyişiniz", nothing_yet: "Hələ heç nə yoxdur. Müəlliminiz tezliklə dərs əlavə edəcək.",
  edit_student: "Tələbəni redaktə et", no_results: "Nəticə yoxdur.", groups_optional: "Qruplar (istəyə görə)", logged_in: "Daxil olub",
};
const ru: Dict = {
  access_key: "Ключ доступа", sign_in: "Войти", teacher_sign_in: "Вход для преподавателя", student_sign_in: "Вход для студента",
  username: "Имя пользователя", password: "Пароль", forgot_password: "Забыли пароль?", sign_out: "Выйти",
  dashboard: "Панель", students: "Студенты", groups: "Группы", catalogs: "Каталоги", exams: "Экзамены", settings: "Настройки",
  online_now: "Сейчас онлайн", nobody_online: "Сейчас никого нет онлайн.", active_today: "Активны сегодня",
  pending_reviews: "Ответы на проверку", inbox: "Входящие", questions: "Вопросы", vocabulary: "Словарь",
  recent_activity: "Последняя активность", no_activity: "Активности пока нет.", upcoming_exams: "Экзамены", recent_catalogs: "Каталоги",
  add_student: "Добавить студента", first_name: "Имя", last_name: "Фамилия", group: "Группа", status: "Статус", last_active: "Последняя активность",
  active: "Активен", disabled: "Отключён", archived: "В архиве", all: "Все", search: "Поиск", save: "Сохранить", cancel: "Отмена",
  create: "Создать", new_key: "Новый ключ", end_sessions: "Завершить сеансы", disable: "Отключить", enable: "Включить", archive: "В архив",
  key_once: "Скопируйте ключ сейчас. Он больше не будет показан.", copy: "Копировать", copied: "Скопировано", close: "Закрыть", edit: "Изменить",
  members: "Участники", add_group: "Добавить группу", name: "Название", description: "Описание", delete: "Удалить", never: "Никогда",
  add_catalog: "Новый каталог", items: "Элементы", add_exam: "Новый экзамен", title: "Название", duration_min: "Длительность (мин)",
  available_from: "Доступен с", available_until: "Доступен до", draft: "Черновик", scheduled: "Запланирован", finished: "Завершён",
  welcome: "Добро пожаловать", language: "Язык", your_progress: "Ваш прогресс", nothing_yet: "Пока пусто. Преподаватель скоро добавит уроки.",
  edit_student: "Изменить студента", no_results: "Ничего не найдено.", groups_optional: "Группы (необязательно)", logged_in: "Вход выполнен",
};
const tr: Dict = {
  access_key: "Erişim anahtarı", sign_in: "Giriş yap", teacher_sign_in: "Öğretmen girişi", student_sign_in: "Öğrenci girişi",
  username: "Kullanıcı adı", password: "Şifre", forgot_password: "Şifrenizi mi unuttunuz?", sign_out: "Çıkış",
  dashboard: "Panel", students: "Öğrenciler", groups: "Gruplar", catalogs: "Kataloglar", exams: "Sınavlar", settings: "Ayarlar",
  online_now: "Şu an çevrimiçi", nobody_online: "Şu an kimse çevrimiçi değil.", active_today: "Bugün aktif",
  pending_reviews: "İncelenecek cevaplar", inbox: "Gelen kutusu", questions: "Sorular", vocabulary: "Kelimeler",
  recent_activity: "Son etkinlik", no_activity: "Henüz etkinlik yok.", upcoming_exams: "Sınavlar", recent_catalogs: "Kataloglar",
  add_student: "Öğrenci ekle", first_name: "Ad", last_name: "Soyad", group: "Grup", status: "Durum", last_active: "Son etkinlik",
  active: "Aktif", disabled: "Devre dışı", archived: "Arşivde", all: "Tümü", search: "Ara", save: "Kaydet", cancel: "İptal",
  create: "Oluştur", new_key: "Yeni anahtar", end_sessions: "Oturumları kapat", disable: "Devre dışı bırak", enable: "Etkinleştir", archive: "Arşivle",
  key_once: "Bu anahtarı şimdi kopyalayın. Tekrar gösterilmeyecek.", copy: "Kopyala", copied: "Kopyalandı", close: "Kapat", edit: "Düzenle",
  members: "Üyeler", add_group: "Grup ekle", name: "Ad", description: "Açıklama", delete: "Sil", never: "Hiç",
  add_catalog: "Yeni katalog", items: "Öğeler", add_exam: "Yeni sınav", title: "Başlık", duration_min: "Süre (dakika)",
  available_from: "Başlangıç", available_until: "Bitiş", draft: "Taslak", scheduled: "Planlandı", finished: "Bitti",
  welcome: "Hoş geldiniz", language: "Dil", your_progress: "İlerlemeniz", nothing_yet: "Henüz bir şey yok. Öğretmeniniz yakında ders ekleyecek.",
  edit_student: "Öğrenciyi düzenle", no_results: "Sonuç yok.", groups_optional: "Gruplar (isteğe bağlı)", logged_in: "Giriş yaptı",
};
const DICTS: Record<Lang, Dict> = { az, en, ru, tr };

export function translate(lang: Lang, key: string) {
  return DICTS[lang][key] ?? en[key] ?? key;
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (k: string) => string };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ defaultLang, children }: { defaultLang: string; children: ReactNode }) {
  const initial = (LANGS.some((l) => l.code === defaultLang) ? defaultLang : "az") as Lang;
  const [lang, setLangState] = useState<Lang>(initial);
  useEffect(() => {
    const saved = localStorage.getItem("ui_lang") as Lang | null;
    if (saved && saved in DICTS) setLangState(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = (l: Lang) => { localStorage.setItem("ui_lang", l); setLangState(l); };
  return <I18nContext.Provider value={{ lang, setLang, t: (k) => translate(lang, k) }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const c = useContext(I18nContext);
  if (!c) throw new Error("useI18n outside provider");
  return c;
}
