/** Registry of question types. New types are added here; the database stores them as text + JSONB payloads. */
export type EditorKind = "choice" | "fixed_choice" | "text" | "open" | "matching" | "ordering";

export type QuestionTypeDef = {
  id: string;
  label: string;
  editor: EditorKind;
  multiple?: boolean;
  fixedOptions?: string[];
  defaultGrading?: "automatic" | "manual" | "ai_assisted";
};

export const QUESTION_TYPES: QuestionTypeDef[] = [
  { id: "single_choice", label: "Single choice", editor: "choice" },
  { id: "multiple_choice", label: "Multiple choice", editor: "choice", multiple: true },
  { id: "true_false", label: "True / False", editor: "fixed_choice", fixedOptions: ["True", "False"] },
  { id: "true_false_not_given", label: "True / False / Not Given", editor: "fixed_choice", fixedOptions: ["True", "False", "Not Given"] },
  { id: "yes_no_not_given", label: "Yes / No / Not Given", editor: "fixed_choice", fixedOptions: ["Yes", "No", "Not Given"] },
  { id: "word_bank", label: "Word-bank selection", editor: "choice" },
  { id: "short_answer", label: "Short answer", editor: "text" },
  { id: "fill_blank", label: "Fill in the blank", editor: "text" },
  { id: "cloze", label: "Multiple blanks / cloze", editor: "text" },
  { id: "sentence_completion", label: "Sentence completion", editor: "text" },
  { id: "summary_completion", label: "Summary completion", editor: "text" },
  { id: "note_completion", label: "Note completion", editor: "text" },
  { id: "table_completion", label: "Table completion", editor: "text" },
  { id: "flowchart_completion", label: "Flow-chart completion", editor: "text" },
  { id: "error_correction", label: "Error correction", editor: "text" },
  { id: "word_formation", label: "Word formation", editor: "text" },
  { id: "sentence_transformation", label: "Sentence transformation", editor: "text" },
  { id: "dictation", label: "Dictation", editor: "text" },
  { id: "listening_transcription", label: "Listening transcription", editor: "text" },
  { id: "open_text", label: "Open text", editor: "open", defaultGrading: "manual" },
  { id: "long_text", label: "Long text / essay", editor: "open", defaultGrading: "manual" },
  { id: "matching_pairs", label: "Matching pairs", editor: "matching" },
  { id: "matching_information", label: "Matching information", editor: "matching" },
  { id: "matching_headings", label: "Matching headings", editor: "matching" },
  { id: "matching_features", label: "Matching features", editor: "matching" },
  { id: "matching_sentence_endings", label: "Matching sentence endings", editor: "matching" },
  { id: "drag_to_match", label: "Drag to match", editor: "matching" },
  { id: "image_labelling", label: "Image labelling", editor: "matching" },
  { id: "diagram_labelling", label: "Diagram labelling", editor: "matching" },
  { id: "map_labelling", label: "Map / plan labelling", editor: "matching" },
  { id: "ordering", label: "Ordering / sequencing", editor: "ordering" },
];

export const TYPE_BY_ID = Object.fromEntries(QUESTION_TYPES.map((t) => [t.id, t])) as Record<string, QuestionTypeDef>;
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
