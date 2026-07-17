#!/bin/sh
# Готовит profiles2/ — штатные профили образа + наши кастомные добавления, в ОДНОЙ директории.
# Обязательно один каталог: CUSTOMPROFILESPATH (/customprofiles) в текущей сборке образа не
# работает вообще (см. README.md, "Грабля 2") — сервер ищет profile=<имя> только в PROFILESPATH.
# Скрипт воспроизводим (не коммитим содержимое profiles2/ — там чужие файлы образа со своими
# лицензиями, см. .gitignore), перезапускать при обновлении версии образа BRouter.
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILES_DIR="$SCRIPT_DIR/profiles2"
IMAGE="ghcr.io/abrensch/brouter:nightly"

echo "-> Извлекаю штатные профили из $IMAGE"
docker pull "$IMAGE" >/dev/null
rm -rf "$PROFILES_DIR"
mkdir -p "$PROFILES_DIR"
cid=$(docker create "$IMAGE")
docker cp "$cid:/profiles2/." "$PROFILES_DIR/"
docker rm "$cid" >/dev/null

echo "-> Докачиваю кастомные профили"
curl -fsS -o "$PROFILES_DIR/gravel-m11n.brf" \
    'https://bikerouter.de/profiles/m11n-gravel-pre.brf'
curl -fsS -o "$PROFILES_DIR/ffm-long-distance.brf" \
    'https://raw.githubusercontent.com/FFMbyBicycle/brouter-cycling-profiles/master/FFMbyBicycle-long-distance-cycling.brf'

echo "Готово: $(ls "$PROFILES_DIR" | wc -l) файлов в $PROFILES_DIR"
