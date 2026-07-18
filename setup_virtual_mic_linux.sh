#!/bin/bash
# Creates a system-wide virtual microphone on Linux (PulseAudio or PipeWire's
# pulse-compatible layer - both speak pactl) so ANY app (Discord, Zoom, games,
# browsers...) can pick the converted voice as its mic input, the same way
# VB-Cable does on Windows.
#
# Usage:
#   bash setup_virtual_mic_linux.sh            # create the sink now (until reboot/logout)
#   bash setup_virtual_mic_linux.sh --autostart # also recreate it automatically every login
#   bash setup_virtual_mic_linux.sh --remove    # unload the sink and remove autostart
set -eu

SINK_NAME="VoiceChangerMic"
SERVICE_NAME="voicechanger-virtual-mic"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

if ! command -v pactl >/dev/null 2>&1; then
    echo "pactl not found. Install it first:" >&2
    echo "  Debian/Ubuntu: sudo apt install pulseaudio-utils   (or pipewire-pulse if you're on PipeWire)" >&2
    echo "  Fedora:        sudo dnf install pulseaudio-utils" >&2
    echo "  Arch:          sudo pacman -S libpulse" >&2
    exit 1
fi

create_sink() {
    local existing
    existing=$(pactl list short modules | awk -v name="sink_name=$SINK_NAME" '$0 ~ name {print $1}')
    if [ -n "$existing" ]; then
        echo "Virtual mic '$SINK_NAME' is already loaded."
        return
    fi
    pactl load-module module-null-sink sink_name="$SINK_NAME" sink_properties=device.description="VoiceChanger_Virtual_Mic" >/dev/null
    echo "Created virtual mic '$SINK_NAME'."
}

remove_sink() {
    local ids
    ids=$(pactl list short modules | awk -v name="sink_name=$SINK_NAME" '$0 ~ name {print $1}')
    for id in $ids; do
        pactl unload-module "$id"
    done
    echo "Removed virtual mic '$SINK_NAME'."
}

install_autostart() {
    mkdir -p "$SERVICE_DIR"
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=VoiceChanger virtual microphone (PulseAudio/PipeWire null-sink)
After=pulseaudio.service pipewire-pulse.service
PartOf=pulseaudio.service pipewire-pulse.service

[Service]
Type=oneshot
ExecStart=/usr/bin/pactl load-module module-null-sink sink_name=${SINK_NAME} sink_properties=device.description=VoiceChanger_Virtual_Mic
RemainAfterExit=true

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now "${SERVICE_NAME}.service"
    echo "Installed autostart: '$SINK_NAME' will be recreated on every login."
}

remove_autostart() {
    if systemctl --user is-enabled "${SERVICE_NAME}.service" >/dev/null 2>&1; then
        systemctl --user disable --now "${SERVICE_NAME}.service" || true
    fi
    rm -f "$SERVICE_FILE"
    systemctl --user daemon-reload 2>/dev/null || true
}

case "${1:-}" in
    --remove)
        remove_autostart
        remove_sink
        exit 0
        ;;
    --autostart)
        create_sink
        install_autostart
        ;;
    "")
        create_sink
        ;;
    *)
        echo "Unknown option: $1 (expected --autostart or --remove)" >&2
        exit 1
        ;;
esac

echo
echo "Setup:"
echo "  1. In VCClient's web UI, enable Server Audio and set the OUTPUT device to '$SINK_NAME'."
echo "  2. In any other app, pick 'Monitor of $SINK_NAME' as the microphone."
