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
