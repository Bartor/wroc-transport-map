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

ETL wymaga Pythona 3.10+ z `openpyxl` i `pyshp`:

```bash
pip install openpyxl pyshp
```

Pierwsze uruchomienie ETL pobiera sieć drogową i przystanki z Overpass API
(kilka minut) i zapisuje je w `etl/cache/`. Kolejne uruchomienia są szybkie.

## Co jest na mapie

| Warstwa | Punktów | Źródło | Współrzędne |
|---|---|---|---|
| Ruch drogowy | 244 przekroje | Zał. 3.3 | dokładne, z wykazu |
| Potoki w autobusach i tramwajach | 222 przekroje | Zał. 6.4 | nazwa przystanku → OSM |
| Ruch rowerowy | 43 przekroje | Zał. 3.4 | geokodowane z opisu odcinka |
| Ruch pieszy | 17 przekrojów | Zał. 3.5 | geokodowane z opisu odcinka |
| Potoki w pociągach | 11 kordonów | Zał. 7.1 | stacje z OSM |
| Próba ankietowa | 1174 adresy | shapefile | dokładne |

Suwak godziny i predefiniowane okresy (szczyt poranny, popołudniowy,
międzyszczyt, noc) sterują wielkością znaczników. Dla ruchu drogowego można
wybrać, co jest liczone — wszystkie pojazdy, tylko osobowe, ciężarowe,
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
ustawiane suwakiem, domyślnie 1,3 os./poj.

**To jest założenie, nie dana z KBR.** W dostarczonych załącznikach nie ma
napełnienia samochodów osobowych — Zał. 6.1 dotyczy taboru komunikacji
zbiorowej. Realną wartość zawiera raport z badań ankietowych gospodarstw
domowych; po dołożeniu tego pliku wystarczy podmienić `CAR_OCCUPANCY` w
`etl/build.py`.

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
