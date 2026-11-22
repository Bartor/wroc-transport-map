# KBR Wrocław 2024 — przeglądarka map

Lokalna aplikacja React do oglądania wyników Kompleksowych Badań Ruchu
Wrocław 2024 na mapie. Powstała jako narzędzie robocze do analizy ruchu
samochodowego i sygnalizacji w centrum miasta.

## Uruchomienie

```bash
npm install
```

```bash
npm run etl
```

```bash
npm run dev
```

Testy obliczeń węzła (podział modalny, pomijanie części, napełnienie, link,
CSV) na małym ręcznie policzonym zestawie; `npm run deploy` uruchamia je
przed publikacją:

```bash
npm test
```

ETL wymaga Pythona 3.10+ z `openpyxl` i `pyshp`:

```bash
pip install openpyxl pyshp
```

Pierwsze uruchomienie ETL pobiera sieć drogową i przystanki z Overpass API
(kilka minut) i zapisuje je w `etl/cache/`. Kolejne uruchomienia są szybkie.

## Co jest na mapie

| Warstwa | Punktów | Źródło | Współrzędne |
|---|---|---|---|
| Warstwa | Punktów | Źródło | Współrzędne |
|---|---|---|---|
| Ruch drogowy | 244 przekroje | Zał. 3.3 | dokładne, z wykazu |
| Potoki w autobusach i tramwajach | 222 przekroje | Zał. 6.4 | słupki przystanków → rozkład GTFS |
| Ruch rowerowy | 43 przekroje | Zał. 3.4 | geokodowane z opisu odcinka |
| Ruch pieszy | 17 przekrojów | Zał. 3.5 | geokodowane z opisu odcinka |
| Potoki w pociągach | 11 kordonów | Zał. 7.1 | przecięcie linii z granicą miasta |
| Próba ankietowa | 1174 adresy | shapefile | dokładne |

Mapa pokazuje jedno badanie naraz („Co pokazać"): pomiary drogowe, potoki
pasażerskie, rowery i piesi albo pociągi. Każde ma własną jednostkę, godziny
i zasięg, więc wielkości znaczników z różnych badań nie są porównywalne.
Wyjątkiem są **węzły** — jedyny widok, w którym badania się spotykają, celowo
i w jednej jednostce (osobach): ruch z przekrojów drogowych z napełnieniem
pojazdów zmierzonym w badaniu pasażerów (patrz „Podział modalny w węzłach").

Suwak godzin i predefiniowane okresy (szczyt poranny, popołudniowy,
międzyszczyt, noc) sterują wielkością znaczników. W widoku pomiarów drogowych
można wybrać, co jest liczone — wszystkie pojazdy, tylko osobowe, ciężarowe,
komunikacja zbiorowa albo rowery i UTO na jezdni.

Kliknięcie znacznika otwiera panel z profilem dobowym, podziałem na kierunki
i strukturą rodzajową.

## Okna pomiarowe — dane NIE są porównywalne wprost

To najważniejsze zastrzeżenie do całego zestawu:

| Warstwa | Godziny pomiaru | Współczynnik doby | Podstawa |
|---|---|---|---|
| Ruch drogowy | 24 h albo 5:00–21:00 | — | pomiar |
| Ruch rowerowy | 6–10 i 15–19 | ×1,634 | wyliczone z KBR |
| Ruch pieszy | 6–10 i 15–19 | ×1,634 | założenie |
| Autobusy i tramwaje | 5–9 i 14–18 | ×1,935 | założenie |
| Pociągi | 6–10 i 14–19 | ×1,777 | założenie |

Bez przeliczenia „cała doba” dla rowerzystów, pieszych i pasażerów to w
rzeczywistości suma ośmiu godzin szczytu — czyli liczba nieporównywalna
z całodobowym ruchem drogowym. Aplikacja to sygnalizuje: ostrzeżeniem w panelu
bocznym, adnotacją w dymku znacznika i wyszarzeniem niemierzonych godzin.

Przełącznik „Szacuj całą dobę" mnoży pomiary szczytowe przez współczynniki
wyliczone z tych fragmentów badania, które trwały cały dzień:

* **rower — wyliczone z danych.** 75 przekrojów drogowych ma równoległy pomiar
  ruchu rowerowego na infrastrukturze rowerowej w godzinach 5:00–21:00. To
  prawdziwy dobowy rozkład ruchu rowerowego z tego samego badania.
* **autobusy, tramwaje, pociągi — założenie.** Wykorzystano dobowy rozkład
  LICZBY kursów (kategorie „j" i „k" na 45 przekrojach mierzonych 24 h).
  Zakłada, że napełnienie poza szczytem jest takie jak w szczycie — więc
  zawyża, prawdopodobnie o kilkanaście procent.
* **pieszy — założenie.** W całym KBR nie ma całodziennego pomiaru pieszych.
  Użyto rozkładu rowerowego. Ruch pieszy w centrum ma płaskie, popołudniowo-
  wieczorne maksimum, więc ten współczynnik raczej zaniża.

Każdy współczynnik jest w interfejsie opisany etykietą `pomiar` /
`wyliczone z danych KBR` / `założenie`.

## Pojazdy a ludzie

Pomiary drogowe liczą pojazdy, nie osoby. Przełącznik „Przeliczaj samochody na
osoby" mnoży **wyłącznie samochody osobowe** (kategoria `d`) przez napełnienie
ustawiane suwakiem, domyślnie **1,2 os./poj.**

Źródło: KBR Wrocław 2024, „Załącznik 2.2 wyniki badań ankietowych
w gospodarstwach domowych" do Raportu II, arkusz „Podział zadań
przewozowych", tabela „Średnia liczba osób w samochodzie ogółem oraz według
motywacji podróży": **Wrocław 1,207** (4396 podróży, w których ankietowany
był kierowcą; dni robocze). Pliki: strona KBR 2024 w BIP —
https://bip.um.wroc.pl/artykul/565/70659/kompleksowe-badania-ruchu-we-wroclawiu-i-otoczeniu-kbr-2024
(archiwum „KBRWr_2024_Zalaczniki_do_Raportu2_rozdz_2_ankiety.zip").

Dla godzin, w których liczono ruch drogowy (6–10 i 15–19), przeliczenie
z surowej bazy ankiet daje 1,17 dla mieszkańców Wrocławia i 1,19 razem
z otoczeniem, a dla dojazdów do pracy 1,08 — więc 1,2 to uczciwe zaokrąglenie
opublikowanej wartości. Wartości 1,55 z KBR 2018 nie należy używać: dzieli
liczbę osób w samochodzie przez wszystkie podróże samochodem, także
pasażerów, więc auto z trzema osobami liczy do trzech razy.

To wartość z ankiety o podróżach mieszkańców, a nie obserwacja na przekroju:
ruch tranzytowy i dojazdowy reprezentuje tylko próba z otoczenia Wrocławia.

Dostawczych i ciężarowych celowo nie przeliczamy (KBR nie bada ich napełnienia),
a pasażerów autobusów i tramwajów liczy osobno warstwa komunikacji zbiorowej —
doliczanie ich tutaj byłoby podwójnym liczeniem.

## Warstwa szacunkowa — cała sieć drogowa

244 przekroje to kordony i ringi, nie sieć. Warstwa „Szacowana sieć drogowa"
uzupełnia resztę modelem:

1. **Graf skierowany** z OSM: 22 325 węzłów, 26 419 krawędzi. Węzłami są
   skrzyżowania (geometria pomiędzy nimi jest zwinięta w krawędź), kierunkowość
   bierze pod uwagę `oneway`, ronda i domyślną jednokierunkowość autostrad.
2. **Rozkład ruchu** metodą najszybszej trasy. Źródła to 1174 adresy z próby
   ankietowej — czyli faktyczny rozkład miejsc zamieszkania — plus punkty
   kordonowe ważone zmierzonym na nich natężeniem. Cele losowane z zanikiem
   odległości względem Rynku.
3. **Regresja** log natężenia na: log obciążenia z rozkładu, klasę drogi, liczbę
   pasów i odległość od centrum, dopasowana na 228 przekrojach, które udało się
   przypiąć do krawędzi grafu (16 punktów kordonu obszaru leży poza pobranym
   fragmentem sieci).

**Jakość: R² 0,53 w walidacji krzyżowej, mediana błędu 30%, a dla 10%
najgorszych ulic błąd sięga 90%.** To rząd wielkości, nie pomiar. Ulice,
w których stoi przekrój pomiarowy, pokazują w dymku obie liczby — zmierzoną
i modelową — żeby było widać, jak model kłamie w znanym punkcie.

Sprawdzono też rozkład z ograniczeniem przepustowości (przyrostowy, funkcja
BPR): nie poprawił wyniku (R² 0,527 → 0,527), a kosztował pięciokrotnie dłuższe
liczenie, więc został odrzucony.

### Pozostałe środki transportu

| Tryb | Pomiarów | R² (CV) | Mediana błędu | Warstwa |
|---|---|---|---|---|
| Samochody | 228 | 0,63 | 24% | tak |
| Pasażerowie KZ | 216 | 0,26 | 63% | tak, opisana jako słaba |
| Rowerzyści | 116 | 0,04 | 44% | nie |
| Piesi | 17 | 0,10 | 38% | nie |

Model samochodowy poprawiła jedna cecha z OSM: **liczba ulic zbiegających się
na obu końcach odcinka**. Przetestowano też gęstość sygnalizacji, numery dróg,
mosty, długość ciągu o tej samej nazwie i obecność linii KZ — żadna z nich nie
przeszła walidacji. Ranga drogi wynika ze skrzyżowań, między którymi biegnie,
lepiej niż z jej własnych tagów. Z interakcją `log(obciążenie) × stopień
skrzyżowania` R² wzrosło z 0,53 do 0,63, a mediana błędu spadła z 30% do 24%.

Rower i pieszy zostały odrzucone: ruch rowerowy zależy od tego, czy konkretna
droga rowerowa istnieje i jest znośna, a nie od położenia w sieci; pieszych
zmierzono w 17 punktach w promieniu pół kilometra od Rynku.

### Potoki pasażerskie — dlaczego słabe

Model pasażerski nie przekroczył R² 0,26 mimo sześciu prób: rozkładu ruchu po
sieci samochodowej i po samej sieci KZ, gęstości zamieszkania z próby
ankietowej, liczby przystanków, liczby linii i wariantów tras z OSM, wreszcie
**rzeczywistej liczby kursów z rozkładu jazdy GTFS**. Nie pomogło też
rozłożenie problemu na częstotliwość × napełnienie — samo napełnienie okazało
się jeszcze mniej przewidywalne (R² 0,02–0,06, od 5 do 135 pasażerów na pojazd).

Powód jest w danych, nie w metodzie: pomiar KBR dotyczy konkretnych słupków
przystankowych i wybranych kierunków, a nie „wszystkich pojazdów na tej ulicy".
Korelacja liczby kursów z GTFS ze zmierzoną liczbą pojazdów w punkcie wynosi
0,39 w skali log — te dwie wielkości opisują co innego.

### Rozkład jazdy z API miasta

`etl/gtfs.py` pobiera aktualny rozkład (GTFS, CC0 1.0) z otwartych danych
Wrocławia i nakłada go na graf ulic. Warstwa „Kursy autobusów i tramwajów"
to **dane rozkładowe, nie model**: liczba kursów w typowy dzień roboczy na
każdej ulicy, osobno tramwaj i autobus.

Adapter odpytuje API o najnowszy plik, zamiast trzymać zaszyty link:

```
https://api.open-data.cui.wroclaw.pl/od2/6/  ->  {"pliki": [127, 125, ...]}
https://open-data.cui.wroclaw.pl/hdb/download/127/  ->  GTFS zip
```

Uwaga na hosty: `www.wroclaw.pl/open-data` odpowiada 403 na każde zapytanie
skryptowe (WAF), a `opendata.cui.wroclaw.pl` przekierowuje. Działa
`open-data.cui.wroclaw.pl`; `api.open-data...` ma niepełny łańcuch certyfikatów,
przez co curl odmawia, a Python (magazyn certyfikatów systemu) działa.

## Sygnalizacja świetlna

Warstwa zbudowana pod konkretne pytanie: **które sygnalizacje obsługują tak
mały ruch, że warto sprawdzić, czy są potrzebne.**

1294 sygnalizatory z OSM grupują się w 520 obiektów: 351 skrzyżowań i 169
samodzielnych przejść dla pieszych. Każdy dostaje modelowe natężenie na
wlotach, liczbę kursów KZ z rozkładu jazdy i odległość do najbliższego punktu
pomiaru ruchu pieszego lub rowerowego.

Filtr „tylko ulice lokalne bez tramwaju" zawęża listę do **61 skrzyżowań**,
gdzie wszystkie wloty to ulice klasy `residential`, `living_street`,
`unclassified` lub `tertiary`, i nie jeździ tędy tramwaj. Lista jest posortowana
od najmniejszego natężenia.

To sito, nie rekomendacja. Natężenie jest modelem z medianą błędu 24%,
a o wyłączeniu sygnalizacji decydują też widoczność, przejścia dla pieszych,
priorytet tramwaju i historia zdarzeń — czego w tych danych nie ma.

## Punkty a przekroje

Numer w rodzaju `KW_08B` to **przekrój pomiarowy** wewnątrz **punktu
pomiarowego** `KW_08`. Litera oznacza osobny wlot tego samego miejsca:

* ruch drogowy — osobna jezdnia, ulica albo łącznica (każda ma własne
  współrzędne, więc znaczniki się nie nakładają),
* komunikacja zbiorowa — osobna ulica tego samego węzła; wszystkie przekroje
  siedzą na współrzędnych jednego przystanku,
* ruch rowerowy — strona ulicy (północna / południowa).

Pomiary przekrojów są rozłączne, więc się sumują. Znaczniki leżące dokładnie
na sobie są rozsuwane na mały okrąg (~20 m), a przełącznik „Sumuj przekroje do
punktu pomiarowego" scala je w jeden znacznik z sumą całego punktu.

## Podział modalny w węzłach

Po włączeniu „Sumuj przekroje do punktu pomiarowego" każdy węzeł drogowy jest
rysowany jako wykres kołowy podziału modalnego **w osobach**, bo o to chodzi
w pytaniu o podział modalny — nie o pojazdy.

Węzeł drogowy i punkt pomiaru komunikacji zbiorowej leżące do **150 m** od
siebie łączą się w jeden znacznik (33 pary). Do tej odległości pary to to samo
skrzyżowanie (Arkady ↔ Świdnicka 16 m, Dworzec Główny ↔ Kołłątaja 78 m,
pl. Grunwaldzki 127 m); dalej zaczynają się łączyć różne ulice.

Jak liczone są poszczególne kawałki:

| Tryb | Skąd |
|---|---|
| Samochody osobowe | pojazdy z przekrojów × napełnienie z suwaka — założenie |
| Autobusy, tramwaje | pojazdy z przekrojów × napełnienie zmierzone w sparowanym punkcie KZ; bez pary — średnia miejska z pomiarów KBR (autobus 30,6, tramwaj 62,4 os./poj.) |
| Rowery i hulajnogi | policzeni na jezdni i obok niej — pomiar |
| Dostawcze, ciężarowe, motocykle, mikrobusy | tylko kierowca — dolne oszacowanie |
| Piesi | brak — nie liczono ich na przekrojach drogowych |

Dwie rzeczy, które łatwo zrobić źle:

* **Nie dodajemy surowej liczby pasażerów z punktu KZ.** Oba badania obejmują
  inne słupki i wloty — na Dworcu Głównym punkt KZ ma 8 przekrojów na trzech
  ulicach, a węzeł drogowy 4 przekroje. Strumień definiują przekroje drogowe
  (liczą autobusy i tramwaje jako pojazdy), a punkt KZ dostarcza tylko tego,
  jak bardzo te pojazdy są zapełnione. Przykład: na pl. Legionów w 15–17 punkt
  KZ ma 19 082 pasażerów, z czego 13 271 na słupkach przy Piłsudskiego — ulicy,
  na której węzeł R1_03 nie ma przekroju. Ponadto pojazd, który zatrzymał się
  na dwóch badanych słupkach jednego punktu, jest w zał. 6.4 dwoma wierszami;
  ETL zapisuje takich pasażerów (`repeatByHour`: ten sam pojazd i linia na
  innym słupku w ciągu 10 minut). To 3,5% wszystkich, ale np. 25% na Dworcu
  Głównym (R1_06). Liczba osób w pojeździe to ocena napełnienia na oko w skali
  0–6, przeliczona na osoby według pojemności pojazdu (zał. 6.1).
  Napełnienie użyte w węźle to średnia ze wszystkich zaznaczonych słupków
  sparowanego punktu; panel węzła pokazuje każdy słupek osobno.
* **Godziny ruchu drogowego.** Wszystkie środki w węźle pochodzą z przekrojów
  drogowych, więc węzeł liczy się dla godzin, w których je liczono (zwykle
  5–21, kordon KO tylko 6–10 i 15–19) — węzły są porównywalne w każdym okresie.
  Napełnienie z punktu KZ to stosunek pasażerów do pojazdów, mierzony
  w godzinach badania KZ (6–9 i 14–18 w okresie albo, poza nim, w całym oknie
  badania) i przyjmowany dla wszystkich godzin okresu. Poza godzinami badania
  KZ to założenie, co panel węzła mówi wprost.
* **Za mała próba na przystanku → średnia miejska.** Napełnienia z punktu KZ
  nie używamy, gdy przystanek zarejestrował mniej niż 5 pojazdów danego środka
  albo mniej niż 10% pojazdów policzonych w tych godzinach na przekrojach
  drogowych. Ze 116 zmierzonych napełnień odpada tak 4: autobusy w KW_19
  (przystanek linii 319 — 4 autobusy wobec 94 na al. Karkonoskiej, 0,5 os./poj.)
  i w R1_11 (2 wobec 37).
* **Przepustowość jezdni w pojazdach umownych.** Obok udziału w osobach
  i pojazdach węzeł pokazuje udział w przepustowości: pojazdy z przekrojów
  × współczynniki z WR-D-13 „Wytyczne wykonywania analiz i prognoz ruchu
  drogowego” (Ministerstwo Infrastruktury, 2023), tab. 4.3.1, teren
  zabudowany z sygnalizacją: rower i hulajnoga 0,3, motocykl 0,3, samochód
  i mikrobus 1, dostawczy 1,5, ciężarowy 2,5, z przyczepą 3, autobus 2,5,
  tramwaj 3, ciągniki i maszyny wolnobieżne 3. Rowery poza jezdnią liczą się
  jako 0.
  To miara przepustowości, nie powierzchni, a tramwaj na własnym torowisku
  liczy się tak samo jak na jezdni.

W 10 z 53 węzłów wieloprzekrojowych przekroje leżą na tej samej ulicy po obu
stronach skrzyżowania (np. PR_01 Kazimierza Wielkiego). Tam pojazd jadący na
wprost jest liczony dwa razy: suma zawyża ruch przez węzeł, udziały pozostają
porównywalne. Dymek i panel to sygnalizują.

Etykiety na mapie można włączyć na stałe — jako liczby (#) albo udziały (%).
Przy oddaleniu nakładające się etykiety są ukrywane, większe węzły mają
pierwszeństwo; można to wyłączyć.

## Uwaga o położeniu punktów

Tylko wykaz przekrojów drogowych (Zał. 3.3) zawiera współrzędne. Punkty
rowerowe i piesze są opisane wyłącznie tekstem („ul. Oławska między ul.
Szewską a ul. Łaciarską”), więc ETL wyznacza ich położenie przecinając nazwane
ulice z OpenStreetMap i biorąc środek odcinka. Panel szczegółów pokazuje przy
każdym punkcie, jaką metodą został umiejscowiony. Punkty, których nie da się
tak rozwiązać (kładki, wały, promenady), mają współrzędne wpisane ręcznie w
`etl/overrides.json` — tam też można poprawić każdy znacznik, który wygląda
źle, i ponownie uruchomić `npm run etl`.

Numeracja punktów w Zał. 6.4 (komunikacja zbiorowa) jest **niezależna** od
numeracji przekrojów drogowych mimo tych samych prefiksów: `KW_01` to
„Pracze Odrzańskie" w pomiarach pasażerskich i „ul. Kamieńskiego" w pomiarach
drogowych. Dlatego punkty komunikacji zbiorowej są lokalizowane po nazwie
przystanku, a nie po identyfikatorze.

## Struktura

```
data/     surowe załączniki KBR (xlsx, shp) — nie modyfikowane
etl/      build.py, geocode.py, overrides.json → public/data/*.json
src/      aplikacja React (Leaflet + Recharts)
```

`public/data/` i `etl/cache/` są generowane i nie są śledzone w gicie.

Podkład mapowy i geokodowanie: OpenStreetMap (ODbL).
