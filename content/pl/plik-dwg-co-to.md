---
title: "Plik DWG: co to jest, co jest w środku i jak go otworzyć"
description: "DWG to natywny, zamknięty format rysunków AutoCADa. Co zawiera plik DWG, jakie są wersje, czym różni się od DXF i PDF oraz jak go otworzyć za darmo."
key: what-is-dwg
locale: pl
slug: plik-dwg-co-to
date: 2026-09-21
cluster: format:what-is-dwg
tags: [format, open, dxf, pdf]
facts: [oda-dwg-native-proprietary, oda-dwg-undocumented, oda-dwg-version-ids, libredwg-beta, librecad-dwg-experimental]
tool: home
faq:
  - q: "Otworzę plik DWG bez AutoCADa?"
    a: "Tak. Przeglądarka taka jak ta otwiera DWG i DXF na każdym komputerze i telefonie, bez instalacji. Programy na komputer porównuje poradnik o otwieraniu DWG bez AutoCADa."
  - q: "DWG to to samo co DXF?"
    a: "Nie. Oba opisują ten sam rodzaj rysunku, ale DWG jest zwarty i binarny, a DXF to format wymiany, który zapisze niemal każdy program CAD i CAM. Wiele programów, które nie zapiszą DWG, zapisze DXF."
  - q: "Zamienię DWG na PDF za darmo?"
    a: "Tak. Otwórz rysunek w przeglądarce, kliknij PDF i wybierz obszar, arkusz i skalę. PDF jest wektorowy, więc porządnie się drukuje."
  - q: "Czemu mój DWG wygląda inaczej w innym programie?"
    a: "Bo format nie ma publicznej specyfikacji, więc każdy program spoza Autodesku czyta go własną implementacją, a fonty, których nie wysłano z rysunkiem, są podmieniane. Linie i wymiary zwykle wychodzą tak samo, różnice widać w tekstach i złożonych obiektach."
---

# Plik DWG: co to jest?

Plik .dwg to rysunek techniczny: rzut domu, projekt instalacji elektrycznej, detal dachu, część maszyny. Open Design Alliance, konsorcjum budujące biblioteki DWG dla innych producentów CAD, opisuje DWG jako natywny i zamknięty format plików AutoCADa, a sama nazwa DWG jest znakiem towarowym Autodesku. Czyta go też większość innych programów CAD i dlatego właśnie w nim krążą rysunki między architektem, instalatorem i inwestorem.

Jeśli ktoś przysłał Ci taki plik i chcesz go tylko obejrzeć, [otwórz go w przeglądarce](/pl) za darmo. Nic nie instalujesz, a plik nigdzie nie jest wysyłany.

## Co jest w środku pliku DWG

DWG to nie obrazek. To baza obiektów z dokładnymi współrzędnymi. Dlatego możesz go powiększać bez końca, a odległość zmierzona na rysunku jest prawdziwa.

- **Geometria:** linie, łuki, okręgi, polilinie, kreskowania, wymiary i teksty.
- **Warstwy:** nazwane grupy, np. ściany, elektryka, meble, które da się włączać, wyłączać i zamrażać.
- **Bloki:** powtarzalne symbole, np. gniazdko, drzwi czy krzesło, wstawiane wiele razy, czasem z atrybutami typu opis albo numer katalogowy.
- **Model i arkusze:** w modelu jest sam rysunek w skali 1:1, a arkusze (layouty) układają jego widoki na kartkach z tabelką, gotowe do wydruku.
- **Ustawienia w nagłówku:** np. jednostka rysunku. Nie trzeba jej ustawiać, żeby rysować, więc często jest błędna. W dwóch z trzech prawdziwych rysunków, na których testowaliśmy, jednostka w nagłówku nie zgadzała się z rysunkiem.
- **Odnośniki zewnętrzne (xrefy):** linki do innych rysunków. Jeśli tamtych plików nie dołączono, części rysunku po prostu brakuje.

## Format bez publicznej instrukcji

Open Design Alliance w swojej opublikowanej specyfikacji formatu nazywa DWG nieudokumentowanym i zamkniętym. Programy spoza Autodesku czytają więc DWG niezależnymi implementacjami, jak biblioteki Open Design Alliance albo GNU LibreDWG, wolna biblioteka C do plików DWG, która sama określa się jako wersja beta. Ta przeglądarka jest zbudowana właśnie na GNU LibreDWG.

To też powód, dla którego ten sam DWG potrafi wyglądać trochę inaczej w różnych programach: każdy dekoduje go własnym kodem, a fonty, których nie wysłano razem z rysunkiem, są zastępowane innymi.

## Wersje DWG

Format zmieniał się kilka razy. Pierwsze 6 bajtów każdego pliku DWG to identyfikator wersji, a specyfikacja Open Design Alliance podaje, co który oznacza:

| Identyfikator | Wersja formatu |
|---|---|
| AC1012 | R13 |
| AC1014 | R14 |
| AC1015 | R2000 |
| AC1018 | R2004 |
| AC1021 | R2007 |
| AC1024 | R2010 |
| AC1027 | R2013 |
| AC1032 | R2018 |

Starszy program nie zawsze przeczyta nowszy format. Gdy plik się nie otwiera, zwykle wystarczy poprosić nadawcę o zapis w starszej wersji, np. 2013 albo 2018, albo jako DXF.

## DWG, DXF czy PDF?

| Format | Co to jest | Do czego |
|---|---|---|
| DWG | Zwarta, binarna baza rysunku | Praca nad rysunkiem w programie CAD |
| DXF | Format wymiany tego samego rodzaju rysunku | Przenoszenie rysunku między różnymi programami CAD, CAM i do cięcia laserem |
| PDF | Stałe strony, norma ISO | Wydruk, naniesienie uwag, wysłanie komuś bez CAD |

DXF otworzy prawie każdy program CAD; LibreCAD, darmowy edytor, pracuje na DXF natywnie, a jego biblioteka sama opisuje odczyt DWG jako eksperymentalny. PDF otworzy każdy, ale to już nie jest rysunek, który da się rzetelnie zmierzyć albo edytować.

## Jak otworzyć plik DWG

- **W przeglądarce, na dowolnym urządzeniu:** [darmowa przeglądarka na tej stronie](/pl) czyta plik lokalnie, GNU LibreDWG skompilowanym do WebAssembly. Pokazuje warstwy, [mierzy odległości i pola](/pl/pomiar-dwg) i [zapisuje wektorowy PDF w skali](/pl/dwg-na-pdf).
- **Programem na komputer:** możliwości, ich wymagania i słabe strony opisuje poradnik [jak otworzyć plik DWG bez AutoCADa](/pl/jak-otworzyc-plik-dwg).
