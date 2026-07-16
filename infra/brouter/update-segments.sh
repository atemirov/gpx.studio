#!/bin/sh
# Скачивает/обновляет .rd5-сегменты рельефа BRouter для ЦФО.
# Источник и формат имён — README abrensch/brouter: сегменты 5x5 градусов,
# имя = юго-западный угол, генерируются еженедельно на brouter.de.
# Запуск: ./update-segments.sh  (руками или по cron, см. ниже)
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEGMENTS_DIR="$SCRIPT_DIR/segments4"
BASE_URL="https://brouter.de/brouter/segments4"

# Покрытие ЦФО: E30-E45, N50-N55 (Москва, Тверь, Смоленск, Воронеж, Рязань,
# Владимир, Ярославль, Курск, Белгород и т.д.)
TILES="E30_N50 E30_N55 E35_N50 E35_N55 E40_N50 E40_N55"

mkdir -p "$SEGMENTS_DIR"

for tile in $TILES; do
    file="$tile.rd5"
    tmp="$SEGMENTS_DIR/$file.tmp"
    echo "-> $file"
    # -z: скачивать заново только если на сервере файл новее локального
    curl -fsS -z "$SEGMENTS_DIR/$file" -o "$tmp" "$BASE_URL/$file"
    if [ -s "$tmp" ]; then
        mv "$tmp" "$SEGMENTS_DIR/$file"
    else
        rm -f "$tmp"
    fi
done

echo "Готово: $(du -sh "$SEGMENTS_DIR" | cut -f1) в $SEGMENTS_DIR"
