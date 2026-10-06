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
  questions_bank: "Question Bank", topics: "Topics", add_question: "New question", type: "Type", level: "Level", text: "Text", selected: "selected", select_all: "Select all", clear: "Clear", move_to_trash: "Move to trash", duplicate: "Duplicate", add_to_catalog: "Add to catalog", add_topic: "Add topic", save_next: "Save & add next", prompt: "Question / instructions", options: "Options", correct: "Correct", accepted_answers: "Accepted answers", explanation: "Explanation (optional)", teacher_notes: "Teacher notes", points: "Points", partial_scoring: "Partial scoring", negative_marking: "Negative marking", case_sensitive: "Case sensitive", ignore_punctuation: "Ignore punctuation", ignore_diacritics: "Ignore accents/diacritics", versions: "Versions", version: "Version", duplicate_found: "This question already exists.", save_anyway: "Save anyway", grading: "Grading", automatic: "Automatic", manual: "Teacher review", ai_assisted: "AI-assisted", pairs: "Pairs", order_items: "Items in correct order", add: "Add", parent_topic: "Parent topic", none: "None", back: "Back", blanks_hint: "Use ___ for each blank. Enter accepted answers per blank, separated by |",
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
  questions_bank: "Sual bankı", topics: "Mövzular", add_question: "Yeni sual", type: "Növ", level: "Səviyyə", text: "Mətn", selected: "seçildi", select_all: "Hamısını seç", clear: "Təmizlə", move_to_trash: "Zibil qutusuna at", duplicate: "Surətini çıxar", add_to_catalog: "Kataloqa əlavə et", add_topic: "Mövzu əlavə et", save_next: "Saxla və növbəti", prompt: "Sual / təlimat", options: "Variantlar", correct: "Düzgün", accepted_answers: "Qəbul edilən cavablar", explanation: "İzah (istəyə görə)", teacher_notes: "Müəllim qeydləri", points: "Bal", partial_scoring: "Qismən bal", negative_marking: "Mənfi bal", case_sensitive: "Böyük/kiçik hərf fərqi", ignore_punctuation: "Durğu işarələrini nəzərə alma", ignore_diacritics: "Diakritik işarələri nəzərə alma", versions: "Versiyalar", version: "Versiya", duplicate_found: "Bu sual artıq mövcuddur.", save_anyway: "Yenə də saxla", grading: "Qiymətləndirmə", automatic: "Avtomatik", manual: "Müəllim yoxlaması", ai_assisted: "Sİ köməyi ilə", pairs: "Cütlər", order_items: "Düzgün ardıcıllıqla elementlər", add: "Əlavə et", parent_topic: "Üst mövzu", none: "Yoxdur", back: "Geri", blanks_hint: "Hər boşluq üçün ___ yazın. Hər boşluğun cavablarını | ilə ayırın",
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
  questions_bank: "Банк вопросов", topics: "Темы", add_question: "Новый вопрос", type: "Тип", level: "Уровень", text: "Текст", selected: "выбрано", select_all: "Выбрать все", clear: "Сбросить", move_to_trash: "В корзину", duplicate: "Дублировать", add_to_catalog: "В каталог", add_topic: "Добавить тему", save_next: "Сохранить и следующий", prompt: "Вопрос / инструкция", options: "Варианты", correct: "Верно", accepted_answers: "Принимаемые ответы", explanation: "Пояснение (необязательно)", teacher_notes: "Заметки преподавателя", points: "Баллы", partial_scoring: "Частичные баллы", negative_marking: "Штрафные баллы", case_sensitive: "Учитывать регистр", ignore_punctuation: "Игнорировать пунктуацию", ignore_diacritics: "Игнорировать диакритику", versions: "Версии", version: "Версия", duplicate_found: "Такой вопрос уже существует.", save_anyway: "Всё равно сохранить", grading: "Оценивание", automatic: "Автоматически", manual: "Проверка преподавателем", ai_assisted: "С помощью ИИ", pairs: "Пары", order_items: "Элементы в правильном порядке", add: "Добавить", parent_topic: "Родительская тема", none: "Нет", back: "Назад", blanks_hint: "Используйте ___ для каждого пропуска. Ответы для пропуска разделяйте |",
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
  questions_bank: "Soru bankası", topics: "Konular", add_question: "Yeni soru", type: "Tür", level: "Seviye", text: "Metin", selected: "seçildi", select_all: "Tümünü seç", clear: "Temizle", move_to_trash: "Çöp kutusuna taşı", duplicate: "Çoğalt", add_to_catalog: "Kataloğa ekle", add_topic: "Konu ekle", save_next: "Kaydet ve sonraki", prompt: "Soru / yönerge", options: "Seçenekler", correct: "Doğru", accepted_answers: "Kabul edilen cevaplar", explanation: "Açıklama (isteğe bağlı)", teacher_notes: "Öğretmen notları", points: "Puan", partial_scoring: "Kısmi puan", negative_marking: "Eksi puan", case_sensitive: "Büyük/küçük harf duyarlı", ignore_punctuation: "Noktalamayı yok say", ignore_diacritics: "Aksanları yok say", versions: "Sürümler", version: "Sürüm", duplicate_found: "Bu soru zaten var.", save_anyway: "Yine de kaydet", grading: "Değerlendirme", automatic: "Otomatik", manual: "Öğretmen incelemesi", ai_assisted: "YZ destekli", pairs: "Eşleşmeler", order_items: "Doğru sırayla öğeler", add: "Ekle", parent_topic: "Üst konu", none: "Yok", back: "Geri", blanks_hint: "Her boşluk için ___ kullanın. Her boşluğun cevaplarını | ile ayırın",
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
