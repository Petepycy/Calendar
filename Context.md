# Aktualizacja Dokumentacji Projektu Technicznego: Architektura Grafowa Agenta AI z Przepływem Pracy Human-in-the-Loop w Oparciu o LangGraph

## 1. Streszczenie Wykonawcze i Wizja Architektoniczna

Niniejszy raport stanowi kompleksową aktualizację Dokumentacji Projektu Technicznego (TDD), definiującą przejście od liniowego modelu wywołań API (tzw. "Raw API") do zaawansowanej, cyklicznej architektury opartej na grafach stanów, realizowanej za pomocą frameworka **LangGraph**. Głównym motywatorem tej transformacji jest konieczność wdrożenia niezawodnych mechanizmów **Human-in-the-Loop (HITL)**, które są niezbędne w procesach krytycznych, takich jak finalizacja rezerwacji zasobów.

Dotychczasowe podejście, polegające na bezstanowych punktach końcowych REST i efemerycznym kontekście przechowywanym w pamięci operacyjnej, okazało się niewystarczające do zarządzania długotrwałymi transakcjami, w których potwierdzenie użytkownika następuje asynchronicznie i może być opóźnione w czasie. Wprowadzenie LangGraph umożliwia stworzenie trwałej maszyny stanów, zdolnej do wstrzymywania wykonywania ("zamrażania" stanu), persystencji kontekstu w bazie PostgreSQL oraz płynnego wznawiania procesu w reakcji na zdarzenia zewnętrzne, takie jak webhooki z platformy Telegram.

Projekt wprowadza trzy fundamentalne filary architektoniczne:

1. **Orkiestracja Oparta na Grafie:** Dekompozycja logiki agenta na dyskretne, testowalne węzły (`Conversation`, `HumanReview`, `Booking`) połączone warunkowymi krawędziami, tworzące deterministyczny przepływ sterowania.
2. **Trwała Persystencja Stanu:** Wykorzystanie `PostgresSaver` do serializacji pamięci agenta i stosu wykonania do bazy PostgreSQL, co zapewnia odporność na restarty usług i umożliwia obsługę wieloetapowych konwersacji rozciągniętych w czasie.
3. **Wznawianie Sterowane Zdarzeniami:** Ścisła integracja webhooków Telegrama z mechanizmem `Command` w LangGraph, pozwalająca na bezpośrednie odblokowanie wstrzymanego stanu grafu poprzez interakcję użytkownika (kliknięcie przycisku).

Implementacja została podzielona na cztery fazy: **Fundamenty**, **Logika Biznesowa**, **Agent LangGraph** oraz **Interfejs Telegram**, co zapewnia systematyczną migrację przy minimalnym ryzyku operacyjnym.

---

## 2. Analiza Architektoniczna: Ograniczenia Podejścia "Raw API" a Model Grafowy

### 2.1 Krytyka Liniowej Logiki API

W tradycyjnym modelu "Raw API", proces rezerwacji jest zazwyczaj implementowany jako łańcuch wywołań funkcji lub zagnieżdżonych instrukcji warunkowych wewnątrz kontrolera REST. Podejście to, choć proste w początkowej fazie, generuje znaczący dług technologiczny w miarę wzrostu złożoności systemu.

- **Kruchość Stanu:** Kontekst konwersacji jest często przechowywany w pamięci procesu lub w prostym cache (np. Redis) bez wersjonowania. Restart serwera w momencie oczekiwania na decyzję użytkownika prowadzi do utraty kontekstu i "zawieszenia" transakcji w nieznanym stanie.
- **Złożoność Obsługi Przerwań (Interrupts):** Aby obsłużyć potwierdzenie użytkownika, API musi zapisać parametry (data, zasób) do tymczasowego magazynu, wysłać wiadomość i zakończyć działanie wątku. Webhook obsługujący odpowiedź ("Wznów") musi następnie pobrać te dane, zwalidować je i wywołać inną funkcję finalizującą. Powoduje to fragmentację logiki biznesowej na rozłączne ścieżki kodu, co utrudnia debugowanie i testowanie.
- **Brak Determinizmu:** W modelu liniowym trudno jest obsłużyć scenariusze, w których użytkownik zmienia zdanie w trakcie procesu (np. cofa się o krok). Wymaga to skomplikowanej logiki "if-else", która szybko staje się nieczytelna.

### 2.2 Rozwiązanie: Maszyna Stanów LangGraph

LangGraph odwraca ten model, traktując przepływ pracy jako graf skierowany.

- **Zunifikowana Logika:** Węzeł `Booking` jest bezpośrednio połączony z węzłem `HumanReview`. Z perspektywy definicji grafu, proces jest ciągły, mimo że w rzeczywistości może zostać przerwany na godziny lub dni.
- **Mechanizm Checkpointów:** `PostgresSaver` pełni rolę pamięci długotrwałej grafu. Każdy krok jest transakcyjny. Gdy graf zatrzymuje się na węźle `HumanReview`, jego pełny stan (zmienne, historia wiadomości) jest commitowany do bazy PostgreSQL.
- **Wznawianie przez Command:** Gdy webhook Telegrama otrzyma sygnał potwierdzenia, graf ładuje stan z bazy, "wstrzykuje" decyzję użytkownika jako wynik węzła przerywającego i wykonuje przejście do węzła `Booking` tak, jakby nastąpiło to natychmiastowo.

### 2.3 Tabela Porównawcza Architektur

| Cecha | Legacy (Raw API) | Nowa Architektura (LangGraph) |
|---|---|---|
| **Sterowanie Przepływem** | Liniowe, "hard-coded" w funkcjach Python. | Cykliczne, definiowane przez węzły i krawędzie w `StateGraph`. |
| **Zarządzanie Stanem** | Przekazywane w ciele żądania lub Redis (klucz-wartość). | Zarządzane natywnie przez graf; delty stanu są zapisywane w Postgres. |
| **Human-in-the-Loop** | Skomplikowane pętle pollingu lub rozłączne endpointy. | Wbudowane wsparcie przez `interrupt`; stan jest "zamrożony" do momentu wznowienia. |
| **Persystencja** | Efemeryczna; restart serwera gubi kontekst. | Trwała; checkpointy umożliwiają "podróż w czasie" i odtwarzanie sesji. |
| **Współbieżność** | Ryzyko wyścigów (Race Conditions) przy wielu krokach. | Optimistic Concurrency Control (OCC) dzięki wersjonowaniu checkpointów. |

---

## 3. Projekt Bazy Danych i Persystencja Stanu

Fundamentem nowej architektury jest warstwa danych, która musi obsługiwać dwa rozłączne, ale współpracujące ze sobą domeny: stan wykonania agenta (meta-dane techniczne) oraz dane biznesowe (rezerwacje). Projekt zakłada wykorzystanie PostgreSQL jako silnika dla obu tych domen, co upraszcza infrastrukturę i zapewnia spójność transakcyjną.

### 3.1 Warstwa Persystencji LangGraph (Checkpointer)

Wykorzystamy bibliotekę `langgraph-checkpoint-postgres`. W przeciwieństwie do prostych magazynów JSON, biblioteka ta implementuje system partycjonowanych, wersjonowanych checkpointów, co jest kluczowe dla skalowalności w środowisku produkcyjnym.

**Wymagania Techniczne:**

- **`AsyncPostgresSaver`:** Ze względu na asynchroniczną naturę FastAPI (`async def`), użycie asynchronicznej wersji savera jest obligatoryjne.
- **Pula Połączeń (Connection Pooling):** `psycopg_pool.AsyncConnectionPool` musi być współdzielona pomiędzy checkpointerem a logiką biznesową aplikacji, aby zapewnić efektywne zarządzanie zasobami bazy danych.
- **Inicjalizacja:** Metoda `checkpointer.setup()` musi zostać wywołana podczas zdarzenia startowego aplikacji (startup event), aby utworzyć wymagane tabele systemowe (`checkpoints`, `writes`, `checkpoint_blobs`).

**Izolacja Schematu:**

Aby zachować czystość architektury ("Clean Architecture"), tabele LangGraph powinny rezydować w dedykowanym schemacie (np. `agent_state`) lub wykorzystywać domyślny schemat publiczny, jeśli separacja jest obsługiwana przez konwencje nazewnicze. Kluczowym elementem jest struktura tabeli `checkpoints`, która zawiera `thread_id` (mapowany na ID użytkownika Telegrama) oraz `checkpoint_id`.

**Strategia Wielodostępności (Multi-Tenancy) w Checkpointach:**

`thread_id` jest kluczem głównym dla checkpointów. W systemie obsługującym wielu najemców (SaaS), identyfikator wątku musi być unikalny globalnie lub zawierać kontekst najemcy. Rekomendowanym wzorcem jest format kompozytowy: `"{tenant_id}:{user_id}"` lub użycie UUID jako `thread_id` z oddzielną tabelą mapującą metadane użytkownika.

### 3.2 Schemat Logiki Biznesowej: Zaawansowane Więzy Integralności

Węzeł `Booking` wymaga bezwzględnych gwarancji spójności danych, aby zapobiec zjawisku podwójnej rezerwacji (double-booking). Standardowe sprawdzenia na poziomie aplikacji (Read -> Check -> Write) są podatne na warunki wyścigu. Rozwiązaniem jest zastosowanie natywnych **Więzów Wykluczających (Exclusion Constraints)** PostgreSQL przy użyciu indeksów GIST oraz typu zakresowego `TSTZRANGE`.

**Definicja Modelu (SQLAlchemy 2.0 Style):**

```python
from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.dialects.postgresql import TSTZRANGE, ExcludeConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class Booking(Base):
    __tablename__ = 'bookings'

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    resource_id: Mapped[int] = mapped_column(Integer, nullable=False)
    # Kluczowa kolumna zakresowa: Timestamp with Time Zone Range
    during: Mapped = mapped_column(TSTZRANGE(), nullable=False)

    __table_args__ = (
        # Natywny constraint wykluczający Postgres:
        # Zapobiega wierszom, gdzie resource_id jest równe ORAZ zakresy czasu zachodzą na siebie (&&)
        ExcludeConstraint(
            ('resource_id', '='),
            ('during', '&&'),
            name='no_double_booking_constraint'
        ),
    )
```

**Implikacje Techniczne:**

Zastosowanie **ExcludeConstraint** przenosi odpowiedzialność za spójność na jądro bazy danych. Jest to rozwiązanie atomowe -- próba wstawienia nakładającego się zakresu czasu zakończy się błędem `IntegrityError` (konkretnie `23P01 exclusion_violation`), który może być przechwycony przez aplikację i przetłumaczony na przyjazny komunikat dla użytkownika ("Wybrany termin jest już zajęty"). Użycie `TSTZRANGE` eliminuje również błędy brzegowe (np. czy koniec okresu jest domknięty czy otwarty), ponieważ Postgres obsługuje to matematycznie.

**Strategia Implementacji Row Level Security (RLS):**

- **Polityka RLS:** Utworzenie polityki na tabeli `bookings`, która wymusza sprawdzanie `tenant_id`.
- **Zmienna Sesyjna:** W warstwie Dependency Injection (FastAPI), przed udostępnieniem sesji bazy danych, wykonujemy polecenie SQL `SET app.current_tenant = '...'`.

**Definicja Polityki:**

```sql
CREATE POLICY tenant_isolation_policy ON bookings
USING (tenant_id = current_setting('app.current_tenant')::text);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
```

**Użytkownik Bazy Danych:** Użytkownik łączący się z poziomu aplikacji (`db_user`) nie może być superuserem ani posiadać atrybutu `BYPASSRLS`. Wymagane jest utworzenie dedykowanej roli z ograniczonymi uprawnieniami.

Dzięki temu, nawet jeśli model językowy (LLM) "zhalucynuje" zapytanie próbujące pobrać wszystkie rezerwacje, silnik bazy danych zwróci tylko te wiersze, które należą do aktualnie ustawionego kontekstu najemcy.

---

## 4. Projekt Grafu LangGraph i Logika Węzłów

Sercem aktualizacji jest zastąpienie liniowego kontrolera strukturą `StateGraph`. Poniżej zdefiniowano strukturę stanu oraz logikę poszczególnych węzłów.

### 4.1 Definicja Stanu (AgentState)

Stan grafu musi jawnie śledzić historię konwersacji, szkic rezerwacji oraz status przeglądu (review). Wykorzystanie `TypedDict` zapewnia typowanie statyczne i czytelność.

```python
from typing import Annotated, TypedDict, List, Optional
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
    # Reducer 'add_messages' automatycznie łączy nowe wiadomości z historią
    messages: Annotated[list[BaseMessage], add_messages]
    # Kontekst rezerwacji w trakcie tworzenia (dane z narzędzia)
    booking_draft: Optional[dict]
    # Status sterujący pętlą recenzji
    review_status: Optional[str]  # 'pending', 'approved', 'rejected'
    # Kontekst najemcy dla operacji DB
    tenant_id: str
```

### 4.2 Specyfikacja Węzłów

Architektura wymusza podział na trzy specyficzne węzły logiczne.

#### 4.2.1 Węzeł: `Conversation` (Router)

Jest to punkt wejścia i domyślny router decyzyjny.

**Odpowiedzialność:** Wywołanie modelu LLM (np. GPT-4o) z aktualną historią wiadomości i dostępnymi narzędziami.

**Logika:**

1. Analiza intencji użytkownika. Jeśli intencja to "rezerwacja", LLM wywołuje narzędzie `prepare_booking`.
2. Narzędzie `prepare_booking` waliduje dane wejściowe (poprawność dat, format czasu) i aktualizuje `state["booking_draft"]`.
3. Jeśli szkic rezerwacji jest kompletny, węzeł zwraca dyrektywę przejścia do `HumanReview`.
4. W przeciwnym razie, generuje odpowiedź tekstową do użytkownika (prośba o więcej danych).

#### 4.2.2 Węzeł: `HumanReview` (Punkt Przerwania / HITL)

Węzeł ten pełni rolę "szczeliny powietrznej" (air gap) pomiędzy intencją a wykonaniem. To tutaj następuje kluczowa interakcja Human-in-the-Loop.

**Odpowiedzialność:** Sformułowanie prośby o zatwierdzenie i wyzwolenie przerwania (`interrupt`).

**Logika:**

1. Konstrukcja wiadomości podsumowującej: *"Przygotowałem rezerwację Sali A na godzinę 14:00. Czy chcesz kontynuować?"*
2. Wysłanie wiadomości do Telegrama wraz z klawiaturą Inline (Inline Keyboard) zawierającą przyciski z `callback_data="approve"` oraz `callback_data="reject"`.
3. **KRYTYCZNE:** Wywołanie funkcji **`interrupt()`**. W LangGraph jest to mechanizm zawieszający wykonanie i zapisujący stan. Funkcja ta zwraca wartość dopiero po wznowieniu grafu przez zewnętrzny sygnał.
4. Wartość zwrócona przez `interrupt()` (np. `"approved"` lub `"rejected"`) jest zapisywana do zmiennej lokalnej węzła i determinuje dalszy przepływ.

#### 4.2.3 Węzeł: `Booking` (Wykonawca)

Ten węzeł uruchamia się wyłącznie po wznowieniu grafu z pozytywną decyzją.

**Odpowiedzialność:** Wykonanie transakcji zapisu (WRITE) w bazie danych.

**Logika:**

1. Sprawdzenie wartości przekazanej przez `Command(resume=...)`.
2. Jeśli decyzja to `"approved"`:
   - Instancjonowanie sesji SQLAlchemy.
   - Próba wstawienia rekordu `Booking` (`INSERT`).
   - Obsługa `IntegrityError` (naruszenie `ExcludeConstraint`).
   - Jeśli sukces: wyczyszczenie `booking_draft` i dodanie systemowej wiadomości o sukcesie.
3. Jeśli decyzja to `"rejected"`:
   - Wyczyszczenie `booking_draft` i dodanie systemowej wiadomości o anulowaniu.
4. Powrót do węzła `Conversation` celem sfinalizowania interakcji (np. wysłanie tekstu "Rezerwacja potwierdzona").

### 4.3 Logika Przerwań i Konstrukcja Grafu

Interakcja pomiędzy przerwaniem a wznowieniem jest najbardziej złożonym elementem projektu. Zamiast statycznej konfiguracji `interrupt_before`, użyjemy dynamicznej funkcji `interrupt()` wewnątrz węzła, co pozwala na przekazanie kontekstu (szczegółów rezerwacji) do klienta API lub zapisanie ich w checkpoint'cie jako metadane przerwania.

**Diagram przepływu grafu:**

```mermaid
flowchart LR
    StartNode((START)) --> Conversation
    Conversation -->|"booking_draft exists\n& review_status == pending"| HumanReview
    Conversation -->|"brak szkicu\nlub zakończenie"| EndNode((END))
    HumanReview -->|"interrupt() + resume"| Booking
    Booking --> Conversation
```

**Snippet Konstrukcyjny:**

```python
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.postgres import AsyncPostgresSaver

workflow = StateGraph(AgentState)

workflow.add_node("conversation", conversation_node)
workflow.add_node("human_review", human_review_node)
workflow.add_node("booking", booking_node)

# Krawędzie
workflow.add_edge(START, "conversation")

def route_conversation(state):
    if state.get("booking_draft") and state.get("review_status") == "pending":
        return "human_review"
    return END

workflow.add_conditional_edges("conversation", route_conversation)
workflow.add_edge("human_review", "booking")
workflow.add_edge("booking", "conversation")  # Pętla zwrotna do potwierdzenia

# Kompilacja z Checkpointerem
graph = workflow.compile(checkpointer=postgres_checkpointer)
```

---

## 5. Interfejs Telegram i Integracja Webhooków

Podejście "Raw API" często opierało się na długim odpytywaniu (long-polling) lub utrzymywaniu otwartego połączenia. Nowy projekt wykorzystuje architekturę sterowaną zdarzeniami (webhooki), aby oddzielić interfejs użytkownika od logiki przetwarzania.

### 5.1 Logika Handlera Webhooków

Endpoint FastAPI `/telegram/webhook` obsługuje dwa typy aktualizacji: **Message** (tekst) oraz **CallbackQuery** (kliknięcie przycisku).

#### 5.1.1 Obsługa Wiadomości Tekstowych (Nowe Wejście)

Gdy użytkownik wysyła wiadomość:

1. Ekstrakcja `user_id`.
2. Konfiguracja wątku: `{"configurable": {"thread_id": str(user_id)}}`.
3. Wywołanie: `await graph.invoke({"messages": [HumanMessage(content=text)]}, config=config)`.
4. Graf działa aż do osiągnięcia `END` lub `interrupt`.
   - Jeśli `END`: Ostatnia wiadomość od LLM jest wysyłana do Telegrama.
   - Jeśli `interrupt`: Węzeł `HumanReview` wysłał już przycisk potwierdzenia. Handler FastAPI otrzymuje sygnał przerwania (jako część obiektu zwracanego przez graf) i potwierdza odbiór webhooka (status `200 OK`), nie podejmując dalszych akcji. Stan jest bezpiecznie zapisany w Postgres.

#### 5.1.2 Obsługa Callback Query (Wznowienie)

To kluczowy moment dla przepływu HITL. Gdy użytkownik klika "Zatwierdź":

1. Telegram wysyła `CallbackQuery` z danymi `"approve"`.
2. Handler FastAPI identyfikuje to jako akcję wznowienia.
3. Ekstrakcja `user_id` -> mapowanie na `thread_id`.
4. **Komenda Wznowienia:** Zamiast standardowego `invoke`, używamy obiektu `Command`.

```python
from langgraph.types import Command

# Przekazanie decyzji użytkownika do wstrzymanego węzła
resume_command = Command(resume="approved")

# Graf wznawia działanie od miejsca wywołania interrupt()
await graph.invoke(resume_command, config=config)
```

Graf wykrywa `Command`, wstrzykuje wartość `"approved"` jako wynik funkcji `interrupt()` w węźle `HumanReview` i przechodzi krawędzią do węzła `Booking`.

**Obsługa Idempotentności:**

Jeśli `graph.invoke` rzuci wyjątek wskazujący na nieprawidłowy stan (np. graf już zakończył działanie lub nie oczekuje na wznowienie), handler musi przechwycić ten błąd, zalogować go jako `WARNING` i zwrócić do Telegrama status `200 OK`, aby zapobiec pętli ponawiania żądań przez serwery Telegrama.

### 5.2 Mapowanie Użytkowników Telegrama na Wątki

Dla zapewnienia ścisłej izolacji, strategia mapowania musi być jednoznaczna (1:1).

> **LangGraph `thread_id` = Telegram `user_id`**

**Implikacje Multi-Tenant:** Jeśli bot obsługuje wiele organizacji, `tenant_id` musi być pochodną użytkownika.

- **Opcja A:** Bot wewnętrzny (jedna organizacja) -- `tenant_id` jest statyczne.
- **Opcja B:** Platforma SaaS -- wymagana jest tabela `user_mapping` łącząca Telegram ID z Tenant ID. Zapytanie do tej tabeli musi nastąpić przed wywołaniem grafu, aby zasilić `state["tenant_id"]`.

---

## 6. Szczegółowy 4-Fazowy Plan Implementacji

Poniższy harmonogram definiuje ścieżkę dostarczenia nowej architektury, minimalizując ryzyko regresji.

### Faza 1: Fundamenty (Infrastruktura i Środowisko)

**Cel:** Ustanowienie środowiska uruchomieniowego, warstwy persystencji i struktury projektu.

1. **Restrukturyzacja Projektu:** Adaptacja struktury "monorepo" zoptymalizowanej dla FastAPI i Agentów.
   - `/app/api` -- Trasy (Webhooki).
   - `/app/core` -- Konfiguracja, Logowanie, Bezpieczeństwo.
   - `/app/db` -- Modele SQLAlchemy, migracje Alembic.
   - `/app/graph` -- Węzły LangGraph, krawędzie, definicje stanu.

**Zalecana Struktura Katalogów:**

```text
/backend
├── app
│   ├── api
│   │   ├── __init__.py
│   │   ├── deps.py          # Zależności (get_db, get_tenant)
│   │   └── webhooks.py      # Router Telegrama
│   ├── core
│   │   ├── config.py        # Pydantic Settings
│   │   └── db.py            # AsyncSession, Pool
│   ├── db
│   │   ├── base.py          # DeclarativeBase
│   │   └── models.py        # Booking, UserMapping
│   ├── graph
│   │   ├── state.py         # AgentState
│   │   ├── nodes.py         # Logika węzłów
│   │   └── workflow.py      # Definicja StateGraph
│   ├── services
│   │   └── booking.py       # Logika biznesowa (niezależna od AI)
│   └── main.py              # Entrypoint FastAPI
├── alembic
├── tests
└── pyproject.toml           # Zależności (Poetry/UV)
```

2. **Konfiguracja Postgres:**
   - Uruchomienie kontenera Postgres 16+ z włączonym rozszerzeniem `btree_gist` (niezbędne dla constraintów wykluczających na typach skalarnych oraz dla wydajności zakresów).
   - Konfiguracja `AsyncConnectionPool` w module `app.core.db`.
3. **Migracja Schematu:**
   - Inicjalizacja Alembic.
   - Stworzenie migracji dla tabeli `bookings` z `ExcludeConstraint`.
   - Implementacja skryptu startowego uruchamiającego `PostgresSaver.setup()`, aby utworzyć tabele checkpointów.
4. **Konfiguracja RLS:**
   - Implementacja SQL dla `tenant_isolation_policy`.
   - Utworzenie użytkownika bazy danych `bot_user` (bez uprawnień `BYPASSRLS`).
   - Aktualizacja zależności FastAPI `get_db` o instrukcję `SET app.current_tenant`.

### Faza 2: Logika Biznesowa (Warstwa Serwisowa)

**Cel:** Implementacja logiki rezerwacji niezależnej od AI, w celu zapewnienia poprawności operacyjnej.

1. **Serwis Rezerwacji:**
   - Utworzenie klasy `BookingService`.
   - Metoda `create_booking(tenant_id, resource_id, start, end)`:
     - Konstruuje obiekt `TSTZRANGE`.
     - Wykonuje `INSERT`.
     - Przechwytuje `sqlalchemy.exc.IntegrityError` i tłumaczy go na własny wyjątek `SlotUnavailableException`.
2. **Testy Jednostkowe:**
   - Napisanie testów `pytest` specyficznych dla `ExcludeConstraint`.
   - **Test Case:** Wstawienie Rezerwacji A (14:00-15:00). Próba wstawienia Rezerwacji B (14:30-15:30). Oczekiwany błąd.
   - **Test Case:** Sprawdzenie RLS. Wstawienie Rezerwacji A dla Najemcy X. Zapytanie jako Najemca Y. Oczekiwany brak wyników.
3. **Definicja Narzędzi (Tools):**
   - Opakowanie metod `BookingService` w definicje `@tool` LangChain.
   - Zdefiniowanie schematów Pydantic dla wejść narzędzi (np. `BookingRequest` z walidacją ISO datetime).

### Faza 3: Agent LangGraph (Warstwa Orkiestracji)

**Cel:** Zbudowanie maszyny stanów i integracja logiki HITL.

1. **Konstrukcja Grafu:**
   - Zdefiniowanie `AgentState`.
   - Implementacja węzła `Conversation` używającego `ChatOpenAI` (lub ekwiwalentu) z podpiętymi narzędziami (tool binding).
2. **Implementacja Przerwań:**
   - Implementacja węzła `HumanReview`.
   - Użycie `langgraph.types.interrupt` do zatrzymania egzekucji.
   - Zwrot payloadu przerwania zawierającego podsumowanie rezerwacji.
3. **Implementacja Węzła Wykonawczego:**
   - Logika odczytu wyniku przerwania (wartość `resume`).
   - Warunkowe wywołanie `BookingService` (tylko jeśli `approved`).
   - Obsługa wyjścia narzędzia i aktualizacja stanu.
4. **Testowanie Grafu:**
   - Użycie `MemorySaver` do testów lokalnych (in-memory).
   - Symulacja przepływu: `Invoke` -> Assert `Interrupt` -> Invoke `Command(resume)` -> Assert Completion.

### Faza 4: Interfejs Telegram (Warstwa Integracji)

**Cel:** Połączenie zewnętrznego wyzwalacza z wewnętrznym grafem.

1. **Integracja Aiogram:**
   - Konfiguracja `aiogram.Bot` i `Dispatcher` wewnątrz aplikacji FastAPI.
   - Ustawienie cyklu życia webhooka (`on_event("startup")` -> `bot.set_webhook`).
2. **Budowa UI:**
   - Stworzenie funkcji narzędziowej generującej klawiatury Inline Keyboard dla węzła `HumanReview`.
3. **Router Webhooka:**
   - Implementacja endpointu `POST /webhook`.
   - Obsługa obiektu `types.Update`.
   - **Kluczowe:** Implementacja logiki rozróżniającej "Nową Wiadomość" (Start/Kontynuacja Grafu) od "Callbacku" (Wznowienie Grafu przez `Command`).
4. **Testy End-to-End:**
   - Wdrożenie na środowisko staging (tunelowanie przez Ngrok dla lokalnych testów z API Telegrama).
   - Weryfikacja pełnego cyklu: Użytkownik prosi o rezerwację -> Bot pyta o potwierdzenie -> Użytkownik klika -> Rezerwacja powstaje w Postgres -> Potwierdzenie otrzymane.

---

## 7. Rozważania Operacyjne i Obserwowalność

### 7.1 Obsługa Błędów i Odporność

- **Nieaktualne Przerwania (Stale Interrupts):** Jeśli użytkownik kliknie przycisk starej rezerwacji (np. sprzed 3 dni), graf może być w innym stanie lub wątek może być zarchiwizowany. Metoda `invoke` zgłosi błąd, jeśli wątek nie jest w stanie oczekiwania na wznowienie. Handler FastAPI musi przechwycić ten wyjątek i wysłać użytkownikowi komunikat "Sesja wygasła".
- **Timeouty Bazy Danych:** `PostgresSaver` obsługuje przejściowe błędy połączeń, ale transakcja logiki biznesowej powinna mieć sztywny timeout (np. 5 sekund), aby nie blokować tabeli `bookings` (Lock Contention).

### 7.2 Obserwowalność (Observability)

- **LangSmith:** Włączenie śledzenia poprzez ustawienie `LANGCHAIN_TRACING_V2=true`. Jest to kluczowe dla debugowania przejść stanów grafu i inspekcji wejść/wyjść kroków `interrupt`.
- **Logowanie Strukturalne:** Wszystkie endpointy FastAPI muszą emitować logi strukturalne (JSON) zawierające `thread_id`, `tenant_id` oraz `trace_id`, aby umożliwić korelację żądań webhooka z konkretnymi krokami wykonania grafu w narzędziach typu ELK czy Grafana.

---

## 8. Wnioski

Przedstawiony projekt techniczny transformuje Agenta AI z kruchego skryptu w odporny system rozproszony oparty na **LangGraph**. Zastosowanie Postgres checkpointers gwarantuje trwałość stanu, co jest niezbędne dla procesów asynchronicznych. Integracja **Exclusion Constraints** oraz **Row Level Security** w PostgreSQL zapewnia, że zwiększona autonomia agenta idzie w parze z rygorystycznymi standardami integralności i bezpieczeństwa danych. Czteroetapowy plan wdrożenia nakreśla klarowną ścieżkę egzekucji, priorytetyzując solidne fundamenty danych przed warstwowaniem złożonych zachowań agentowych. Ostatecznym rezultatem jest system, który płynnie łączy konwersacyjną naturę AI z transakcyjną pewnością systemów enterprise.

---

## Dodatek A: Wymagane Wersje Bibliotek

LangGraph zmienia się dynamicznie -- obiekt `Command` i asynchroniczny checkpointer to stosunkowo nowe API. Aby uniknąć generowania kodu w przestarzałym stylu (np. wznawianie przez `ToolMessage`), obowiązują następujące minimalne wersje:

| Biblioteka | Minimalna wersja | Uzasadnienie |
|---|---|---|
| `langgraph` | >= 0.2.20 | Wsparcie dla obiektu `Command` i asynchronicznego checkpointera |
| `langgraph-checkpoint-postgres` | >= 1.0.0 | Stabilne API `AsyncPostgresSaver` |
| `fastapi` | >= 0.110.0 | Lifespan context manager, stabilne async |
| `sqlalchemy` | >= 2.0.0 | Async engine, `mapped_column`, `DeclarativeBase` |
| `aiogram` | >= 3.0.0 | Async-native, Router API, Inline Keyboard Builder |

---

## Dodatek B: Wymagane Zmienne Środowiskowe

| Zmienna | Opis | Przykład |
|---|---|---|
| `DATABASE_URL` | Connection string PostgreSQL (async) | `postgresql+asyncpg://user:pass@host:5432/db` |
| `OPENAI_API_KEY` | Klucz API do modelu LLM | `sk-...` |
| `TELEGRAM_BOT_TOKEN` | Token bota od BotFather | `123456:ABC-DEF...` |
| `TELEGRAM_WEBHOOK_SECRET` | Sekret do weryfikacji nagłówka `X-Telegram-Bot-Api-Secret-Token` | dowolny losowy ciąg |
| `BASE_URL` | Publiczny URL aplikacji (dla rejestracji webhooka) | `https://example.com` |
