"""Minimal redacted fixtures modelling the user-supplied A2 exam PDF format."""
from app.extractors import Extraction, detect_candidates
from app.scoped_answers import extract_scoped_answers


def exam(pages: list[str]) -> Extraction:
    return Extraction(
        "pdf_layout_native",
        [{"page": index + 1, "text": text, "tables": [], "blocks": []}
         for index, text in enumerate(pages)],
        [],
        "\n".join(pages),
        {},
    )


def test_a2_answer_key_recovers_all_sixty_section_scoped_answers():
    text = (
        "Answer Key:\n"
        "Section I: Grammar:\n"
        "1b, 2c, 3a, 4b, 5c, 6b, 7b, 8b, 9a, 10b, "
        "11c, 12a, 13b, 14a, 15c, 16c, 17b, 18a, 19b, 20a\n"
        "Section II: Reading:\n"
        "Task 1: 1c, 2a, 3b, 4c, 5b\n"
        "Task 2: 1T, 2T, 3F, 4T, 5T\n"
        "Task 3: 1F, 2T, 3T, 4T, 5F\n"
        "Task 4: 1a, 2a, 3b, 4c, 5b\n"
        "Task 5: 1F, 2T, 3F, 4T, 5F\n"
        "Section III: Listening:\n"
        "Task 1: 1F, 2F, 3T, 4T, 5F\n"
        "Task 2: 1T, 2T, 3F, 4F, 5T\n"
        "Task 3: 1c, 2e, 3a, 4d, 5g\n"
    )
    answers = extract_scoped_answers(text)
    assert len(answers) == 9
    assert sum(map(len, answers.values())) == 60
    assert answers["grammar", 0]["1"] == "B"
    assert answers["reading", 2]["1"] == "True"
    assert answers["reading", 3]["1"] == "False"
    assert answers["listening", 3]["5"] == "G"


def test_pdf_grammar_and_reading_repeated_numbers_keep_distinct_answers():
    documents = exam([
        "SECTION I: Grammar (Use of English)\n"
        "1. Choose one.\na) first\nb) second\nc) third\n"
        "2. Choose a letter.\na) red\nb) blue\nc) green\n",
        "SECTION II: Reading Comprehension\nReading Task 1\n"
        "Read the text below. A simple passage is here for students.\n"
        "1. Choose one.\na) north\nb) south\nc) east\n",
        "Reading Task 2\nRead and mark True or False.\n"
        "1. A week has seven days.\n❏ True\n❏ False\n",
        "Answer Key:\nSection I: Grammar:\n1b, 2c\n"
        "Section II: Reading:\nTask 1: 1c\nTask 2: 1T\n",
    ])
    items = detect_candidates(documents, profile={"expected_content": "questions"})
    questions = [item["payload"] for item in items if item["item_type"] == "question"]
    assert len(questions) == 4
    assert questions[0]["answer_key"] == {"correct": ["b"]}
    assert questions[1]["answer_key"] == {"correct": ["c"]}
    assert questions[2]["answer_key"] == {"correct": ["c"]}
    assert questions[3]["answer_key"] == {"correct": ["True"]}


def test_auto_import_recognizes_listening_tasks_and_scoped_true_false_answers():
    documents = exam([
        "SECTION III: Listening Comprehension\n"
        "Listening Task 1\nListen and mark True or False.\n"
        "1. First statement.\n❏ True\n❏ False\n"
        "Listening Task 2\nListen and mark True or False.\n"
        "1. Second statement.\n❏ True\n❏ False\n",
        "Answer Key:\nSection III: Listening:\n"
        "Task 1: 1F\nTask 2: 1T\n",
    ])
    items = detect_candidates(documents, profile={"expected_content": "auto"})
    contexts = [i for i in items if i["item_type"] == "listening"]
    questions = [i["payload"] for i in items if i["item_type"] == "question"]
    assert len(contexts) == 2
    assert len(questions) == 2
    assert questions[0]["answer_key"] == {"correct": ["False"]}
    assert questions[1]["answer_key"] == {"correct": ["True"]}
    assert questions[0]["import_context"]["source_ref"] != questions[1]["import_context"]["source_ref"]


def test_normal_flat_qa01_key_remains_supported():
    documents = exam([
        "1. She ___ a teacher.\nA) am\nB) is\nC) are\nD) be\n",
        "Answer Key:\n1. B\n",
    ])
    questions = [i for i in detect_candidates(documents, {"expected_content": "questions"}) if i["item_type"] == "question"]
    assert len(questions) == 1
    assert questions[0]["payload"]["answer_key"] == {"correct": ["b"]}


def test_running_two_column_exam_footer_does_not_pollute_last_option():
    documents = exam([
        "English Level Test ELEMENTARY 1A\n"
        "1. We ___ American.\nA) not\nB) not are\nC) aren't\nD) isn't\n"
        "English Level Test ELEMENTARY 1A\nwww.learnenglishteam.com\n",
        "English Level Test ELEMENTARY 1A\n"
        "2. Have you read this?\nA) No\nB) Yes\n"
        "English Level Test ELEMENTARY 1A\nwww.learnenglishteam.com\n",
        "Answer Key:\n1. C\n2. B\n"
        "English Level Test ELEMENTARY 1A\nwww.learnenglishteam.com\n",
    ])
    items = detect_candidates(documents, {"expected_content": "questions"})
    questions = [i["payload"] for i in items if i["item_type"] == "question"]
    assert len(questions) == 2
    assert questions[0]["payload"]["options"][-1]["text"] == "isn't"
    assert questions[1]["payload"]["options"][-1]["text"] == "Yes"


def test_1801_numbered_c1_entries_are_not_lost_or_deduplicated():
    pages = []
    for first in range(1, 1802, 56):
        rows = [
            f"{number}) lexeme{number} noun C1"
            for number in range(first, min(first + 56, 1802))
        ]
        pages.append("BTU SFL WORD LISTS - C1 LEVEL\n" + "\n".join(rows))
    items = detect_candidates(
        exam(pages),
        {"expected_content": "vocabulary", "learning_language": "en"},
    )
    vocabulary = [item["payload"] for item in items if item["item_type"] == "vocabulary"]
    assert len(vocabulary) == 1801
    assert vocabulary[0]["word"] == "lexeme1"
    assert vocabulary[-1]["word"] == "lexeme1801"
    assert all(item["level"] == "C1" and item["part_of_speech"] == "noun"
               for item in vocabulary)


def test_beginner_100_exercise_table_ids_and_clock_questions_are_preserved():
    documents = exam([
        "BEGINNER\n100 QUESTIONS\nExercise 3: Prepositions.\n"
        "11. ... in the summer\nA) In B) At\n"
        "12. ... at seven\nA) on B) at\n"
        "13. ... June\nA) at B) in\n"
        "14. ... birthday\nA) on B) in\n"
        "15. ... night\nA) in B) at\n"
        "Exercise 4: Irregular verbs. Complete the chart.\n"
        "INFINITIVE\nSIMPLE PAST\nPAST PARTICIPLE\n"
        "16  TO BEGIN\nBEGAN\n"
        "17  TO COST\nCOST\n"
        "18  TO DO\n"
        "19  TO BUY\nBOUGHT\n"
        "20  TO EAT\nATE\n"
        "21  TO GIVE\nGIVEN\n"
        "22  TO TAKE\nTOOK\n"
        "23  TO GO\nGONE\n"
        "24  TO SEE\nSEEN\n"
        "25  TO SPEAK\n",
        "BEGINNER\n100 QUESTIONS\nExercise 5: Vocabulary. Match the verbs.\n"
        "26.\n________ baseball\n27.\n________ a bike\n"
        "28.\n________ the TV\n29.\n________ photos\n30.\n________ a song\n"
        "Exercise 6: Vocabulary. Complete the table.\nNUMBERS\nLETTERS\n"
        "31\n59\n32\n73\n33\n35\n34\n27\n35\n84\n"
        "36\nninety-six\n37\nforty-one\n38\neleven\n39\nthirteen\n40\ntwenty\n",
        "BEGINNER\n100 QUESTIONS\n"
        "Exercise 7: Vocabulary. Write the colour for each group.\n"
        "41\nSnow, Milk, Paper:\n___________\n"
        "42\nChocolate, Tea, Beer:\n___________\n"
        "43\nPlants, Salad, Apples:\n___________\n"
        "44\nThe Sun, Bananas, Cheese:\n___________\n"
        "45\nBuses in London, Roses, Tomatoes:\n___________\n"
        "Exercise 8: Pronunciation. Find the odd one out.\n"
        "46\nDRIVE\nLIKE\nSISTER\nRIDE\n"
        "47\nPOST\nGO\nSLOWLY\nSHOP\n"
        "48\nLUNCH\nMUCH\nUSUALLY\nBUT\n"
        "49\nSQUARE\nSTAIRS\nNEAR\nTHERE\n"
        "50\nTHERE\nTHANKS\nMOTHER\nTHAT\n",
        "BEGINNER\n100 QUESTIONS\nExercise 14: Telling the time.\n"
        "81.\n____________________ 82.\n____________________\n"
        "83.\n____________________ 84.\n____________________\n",
    ])
    pages = [
        [item["payload"] for item in detect_candidates(
            exam([page["text"]]), {"expected_content": "questions"}
        ) if item["item_type"] == "question"]
        for page in documents.pages
    ]
    assert list(map(len, pages)) == [15, 15, 10, 4]
    assert pages[0][5]["prompt"].startswith("TO BEGIN")
    assert pages[1][5]["prompt"].strip() == "59"
    assert pages[1][6]["prompt"].strip() == "73"
    assert pages[1][-1]["prompt"].strip() == "twenty"
    assert pages[2][0]["prompt"].startswith("Snow")
    assert pages[3][0]["prompt"] == "____________________"
    assert pages[3][1]["prompt"] == "____________________"


def test_present_simple_answer_sheet_creates_fill_blank_questions():
    documents = exam([
        "Present Simple Test\nWrite verbs in the Present Simple\n"
        "1. I ____ for Mike. (to work)\n"
        "2. She ____ for the teams. (to play)\n",
        "Answers to the present simple test\n1. work\n2. plays\n",
    ])
    questions = [
        i["payload"] for i in detect_candidates(
            documents, {"expected_content": "questions"}
        ) if i["item_type"] == "question"
    ]
    assert len(questions) == 2
    assert [q["question_type"] for q in questions] == ["fill_blank", "fill_blank"]
    assert [q["answer_key"]["blanks"][0][0] for q in questions] == ["work", "plays"]


def test_real_c1_multisense_glosses_survive_native_candidate_detection():
    # From the teacher's BTU C1 sample, reduced to safe short excerpts.
    source = exam([
        "BTU SFL WORD LISTS - C1 LEVEL\n"
        "1471) projection noun CALCULATION C1\n"
        "1472) projection noun IMAGE C1\n"
        "1650) run verb WORKING C1\n"
        "1651) run verb PUBLISH C1\n"
    ])
    items = detect_candidates(source, {
        "expected_content": "vocabulary", "learning_language": "en",
    })
    vocabulary = [
        item["payload"] for item in items
        if item["item_type"] == "vocabulary"
    ]
    assert len(vocabulary) == 4
    assert [value["word"] for value in vocabulary] == [
        "projection", "projection", "run", "run",
    ]
    assert [value["part_of_speech"] for value in vocabulary] == [
        "noun", "noun", "verb", "verb",
    ]
    assert [value["notes"] for value in vocabulary] == [
        "Source sense: CALCULATION", "Source sense: IMAGE",
        "Source sense: WORKING", "Source sense: PUBLISH",
    ]


def test_beginner_ab_labeled_checkbox_true_false_without_key():
    # The actual 100-question Beginner PDF prints True/False under A/B
    # checkboxes instead of canonical naked True/False labels.
    documents = exam([
        "76. Sarah and Colin live in a new house.\n"
        "A  \uf072 TRUE\nB \uf072 FALSE\n"
        "77. Sarah stays at home every day.\n"
        "A  \uf072 TRUE\nB \uf072 FALSE\n",
    ])
    questions = [
        item["payload"] for item in detect_candidates(
            documents, profile={"expected_content": "questions"}
        ) if item["item_type"] == "question"
    ]
    assert len(questions) == 2
    for question in questions:
        assert question["question_type"] == "true_false"
        assert question["payload"]["options"] == ["True", "False"]
        # Source does not provide a key; require teacher to supply it.
        assert question["answer_key"] == {"correct": []}


def test_checkbox_fixed_choice_maps_letter_key_through_option_label():
    documents = exam([
        "1. A week has seven days.\nA) TRUE\nB) FALSE\n"
        "2. The sun is cold.\nA) FALSE\nB) TRUE\n",
        "Answer Key:\n1. A\n2. A\n",
    ])
    questions = [
        item["payload"] for item in detect_candidates(
            documents, profile={"expected_content": "questions"}
        ) if item["item_type"] == "question"
    ]
    assert len(questions) == 2
    assert [item["question_type"] for item in questions] == ["true_false"] * 2
    assert [item["answer_key"]["correct"] for item in questions] == [
        ["True"], ["False"],
    ]
