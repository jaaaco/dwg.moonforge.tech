---
title: "Projekt domu w DWG od architekta: jak go obejrzeć"
description: Architekt przysłał rzuty domu w DWG, a Ty nie masz AutoCADa? Otwórz je w przeglądarce, zmierz pokój, policz pole i zrób PDF dla wykonawcy. Bez wysyłania pliku.
key: architect-sent-dwg
locale: pl
slug: projekt-domu-dwg-od-architekta
date: "2026-11-20"
cluster: audience:homeowner
tags:
  - open
  - audience
  - measure
facts: []
tool: home
faq:
  - q: Czy mogę u was pobrać darmowy projekt domu w DWG?
    a: Nie. Nie udostępniamy projektów domów, tylko przeglądarkę. Otworzysz w niej każdy plik DWG lub DXF, który już masz, na przykład od swojego architekta.
  - q: Czy wymiar zmierzony w DWG mogę podać wykonawcy?
    a: Najpierw porównaj swój odczyt z wymiarem opisanym przez architekta. Jeśli się zgadzają, jednostka jest dobra. Do budowy zawsze liczą się jednak wymiary z zatwierdzonego projektu, a nie Twoje kliknięcia.
  - q: Architekt przysłał model 3D w DWG. Zobaczę go w 3D?
    a: Nie. Przeglądarka nie pokazuje modeli w 3D ani ich nie renderuje. Poproś architekta o rzuty, przekroje i elewacje w 2D albo o wizualizacje.
  - q: Mogę poprawić coś w projekcie i odesłać architektowi?
    a: "Nie w naszej przeglądarce: ona tylko wyświetla, mierzy i drukuje do PDF. Uwagi najprościej zapisz na wydrukowanym PDF albo wyślij jako listę z wymiarami, które zmierzyłeś."
  - q: Czy plik otworzę bez internetu, na budowie?
    a: Strona musi się raz załadować z internetem. Sam plik jest czytany lokalnie na Twoim urządzeniu i nigdzie nie trafia.
---

# Architekt przysłał projekt domu w DWG. Jak go obejrzeć?

Nie potrzebujesz AutoCADa ani konta. Otwórz [darmową przeglądarkę DWG](/pl), przeciągnij plik do okna albo wybierz go z dysku czy telefonu. Rysunek czyta GNU LibreDWG skompilowany do WebAssembly, w Twojej przeglądarce. Plan Twojego domu nie jest nigdzie wysyłany, więc nie trafia na cudzy serwer.

Działa w aktualnym Chrome, Safari, Firefoksie i Edge, na Windowsie, macOS, Linuksie, iPhonie, iPadzie i Androidzie. Na Macu i na telefonie wygląda to tak samo jak na komputerze z Windowsem.

## Otwórz plik krok po kroku

1. Zapisz załącznik z maila na dysk lub w plikach telefonu.
2. Wejdź na [stronę przeglądarki](/pl) i wybierz plik.
3. Poczekaj chwilę. Detal architektoniczny DWG o rozmiarze 2,6 MB otworzył się u nas w 3,4 s na komputerze i w 2,3 s w widoku telefonu. Przy plikach powyżej 25 MB przeglądarka ostrzega, że na telefonie może to potrwać dłużej.
4. Kliknij dopasowanie rysunku do ekranu, żeby zobaczyć całość.

Jeśli plik się nie otwiera, zajrzyj do sekcji o tym, o co poprosić architekta. Więcej sposobów na otwarcie DWG opisujemy w poradniku [jak otworzyć plik DWG bez AutoCADa](/pl/jak-otworzyc-plik-dwg).

## Jak się poruszać po rysunku

Przesuwasz przeciągnięciem (na telefonie dwoma palcami), przybliżasz kółkiem myszy albo szczypnięciem. Po zgubieniu się wróć do widoku całości.

Projekt domu to zwykle kilka rysunków w jednym pliku: rzut parteru, piętra, dachu, przekroje, elewacje. Często leżą obok siebie, więc oddal widok i poszukaj ich jak na dużej płachcie papieru.

**Warstwy** to przezroczyste folie, na których architekt rozłożył elementy: ściany, meble, wymiary, opisy, instalacje. Wyłącz te, które przeszkadzają. Chcesz czysty układ pomieszczeń? Wyłącz meble i kreskowania. Szukasz gniazdek? Zostaw tylko ściany i elektrykę. Włączenie warstwy zamrożonej od razu ją odmraża, więc nic nie zostanie przed Tobą ukryte.

Usłyszysz też dwa słowa. **Model** to przestrzeń, w której rysunek jest narysowany w rzeczywistej wielkości, i tu mierzysz. **Layout** to arkusz do druku: ramka, tabelka, a w środku viewporty, czyli okna na fragmenty modelu w skali 1:50 czy 1:100. Jeśli szukasz konkretnego arkusza z tabelką i podpisem, najpewniej dostaniesz go od architekta jako PDF.

## Sprawdź wymiar, ale najpierw jednostkę

Włącz pomiar i klikaj punkty. Pomiar przyciąga się do końców linii, środków, przecięć i najbliższego punktu na linii, więc trafisz dokładnie w narożnik ściany. Dostajesz długość, przyrosty dx i dy, kąt i sumę kolejnych odcinków. Sprawdziliśmy go na linii o długości znanej z bazy rysunku: odczyt zgodził się dokładnie. Szczegóły opisujemy w poradniku o [pomiarze w pliku DWG](/pl/pomiar-dwg).

Tu jest pułapka. Jednostkę rysunku czytamy z nagłówka pliku (pole INSUNITS), a ten często kłamie. W 2 z 3 prawdziwych rysunków, na których testowaliśmy, był błędny: jeden deklarował milimetry, a był w centymetrach, drugi deklarował cale, a był metryczny. Dlatego jednostkę możesz zmienić.

Zrób tak:

1. Znajdź na rzucie ścianę lub okno z wymiarem wpisanym przez architekta.
2. Zmierz ten sam odcinek.
3. Jeśli liczba się zgadza, a różni się tylko jednostka albo wynik jest dziesięć czy sto razy za duży, przestaw jednostkę.
4. Dopiero wtedy mierz to, czego na rysunku nie ma.

## Policz pole pokoju

Klikaj kolejne narożniki pomieszczenia po wewnętrznej stronie ścian i zamknij obrys, wracając do pierwszego punktu. Pomiar pokaże pole zamkniętego obrysu. Zmiana jednostki dotyczy też pola, więc zrób najpierw test z poprzedniej sekcji.

Pamiętaj, że to pole po obrysie, który sam wyklikałeś. Powierzchnie w zestawieniu architekta liczone są według przyjętej przez niego metody, więc do umów i formalności bierz liczby z projektu, a swoje traktuj jako kontrolę.

## Zrób PDF dla wykonawcy

Ekipa na budowie rzadko ma czym otworzyć DWG, za to każdy otworzy PDF. Eksport daje wektorowy PDF, czyli linie zostają ostre przy każdym powiększeniu.

1. Wybierz zakres: cały rysunek, aktualny widok albo zaznaczone okno (na przykład sam rzut parteru).
2. Wybierz arkusz od A4 do A0 albo Letter i orientację: automatyczną, pionową lub poziomą.
3. Ustaw skalę: dopasowanie do arkusza albo stałą skalę od 1:1 do 1:1000. Dla rzutu domu sensowne są 1:50 albo 1:100, jeśli zmieszczą się na wybranym arkuszu.
4. Do druku na zwykłej drukarce wybierz czerń i biel, dobierz grubość linii.
5. Obejrzyj podgląd i pobierz plik.

Więcej o skalach i arkuszach w poradniku [DWG na PDF](/pl/dwg-na-pdf). Jeśli wpisujesz skalę na wydruku, sprawdź ją wcześniej pomiarem, bo przy złej jednostce skala też będzie zła.

## O co poprosić architekta, gdy czegoś brakuje

| Co widzisz | O co poprosić |
|---|---|
| Plik się nie otwiera albo pokazuje błąd | O zapis w starszej wersji DWG albo o DXF ([przeglądarka DXF](/pl/przegladarka-dxf) działa tak samo). My nie konwertujemy wersji. |
| Brakuje części rysunku: działki, mebli, konstrukcji | O „zbindowanie” xrefów, czyli wklejenie odnośników zewnętrznych do jednego pliku. Xrefów nie wczytujemy. |
| Napisy wyglądają inaczej albo się przesuwają | O PDF do porównania. Tekst rysujemy otwartą czcionką (osifont), a brakujących czcionek SHX nie wczytujemy. |
| Potrzebujesz arkuszy z tabelką do urzędu lub banku | O komplet PDF. Ten i tak powinien być częścią projektu. |
| Dostałeś model 3D | O rzuty, przekroje i elewacje w 2D. Modeli 3D nie pokazujemy w 3D. |

Nasza opinia: dobrze jest dostać od architekta oba zestawy. PDF jest dokumentem do budowy, a DWG pozwala sprawdzić wymiar, którego nikt nie opisał.

## Czego tu nie zrobisz

Przeglądarka nie edytuje rysunku i nie zapisuje zmian, nie zapisuje do DWG ani DXF i nie eksportuje do JPG czy PNG. Wynik może się też trochę różnić od tego, co architekt widzi u siebie, głównie w tekstach. Jeśli chcesz wiedzieć, co właściwie siedzi w środku pliku, przeczytaj [czym jest plik DWG](/pl/poradniki/plik-dwg-co-to).
