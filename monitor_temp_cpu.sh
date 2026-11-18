#!/bin/bash
#
# monitor_temp_cpu.sh
# Registra temperatura da CPU, uso de CPU, RAM e SWAP.
#
# Pré-requisito: pacote lm-sensors instalado e configurado
#   sudo apt update
#   sudo apt install lm-sensors
#   sudo sensors-detect      (responda as perguntas; o padrão sugerido serve)
#
# O script tenta reconhecer automaticamente o rótulo usado por CPUs
# Intel ("Package id 0:") e AMD ("Tctl:" ou "Tdie:"). Se o comando
# "sensors" mostrar outro rótulo na sua máquina, ajuste a variável
# PADRAO abaixo. A unidade é ignorada porque, com LC_ALL=C, o sensors
# pode exibir "C" em vez de "°C".

export LC_ALL=C

LOGFILE="$HOME/monitoramento_log.csv"
INTERVALO=20                          #setado em segundos
PADRAO="Package id 0:|Tctl:|Tdie:"

if [ ! -s "$LOGFILE" ]; then
    printf 'data_hora;temperatura;cpu_percentual;ram_percentual;swap_percentual\n' >> "$LOGFILE"
fi

if ! command -v sensors &> /dev/null; then
    echo "Comando 'sensors' não encontrado. Instale com: sudo apt install lm-sensors"
    exit 1
fi

echo "Monitoramento iniciado. Registrando em: $LOGFILE"
echo "Pressione Ctrl+C para parar."

while true; do
    DATA_HORA=$(date '+%Y-%m-%d %H:%M:%S')

    # Temperatura da CPU. Lê o primeiro número após o rótulo, sem
    # depender de o sensors usar "C" ou "°C" como unidade.
    TEMP=$(sensors 2>/dev/null | awk -v padrao="$PADRAO" '
        $0 ~ padrao {
            leitura = $0
            sub(/^[^:]*:[[:space:]]*/, "", leitura)
            if (match(leitura, /^[+-]?[0-9]+([.][0-9]+)?/)) {
                print substr(leitura, RSTART, RLENGTH)
                exit
            }
        }
    ')

    if [ -z "$TEMP" ]; then
        TEMP="N/D"
    else
        TEMP="${TEMP}°C"
    fi

    # Uso de CPU (%)
    CPU_USO=$(top -bn1 | grep "Cpu(s)" | awk '{print 100 - $8}')
    CPU_USO=$(printf "%.1f" "$CPU_USO")

    # Uso de RAM (%)
    RAM_USO=$(free | awk '/Mem:/ {printf "%.1f", ($3/$2)*100}')

    # Uso de SWAP (%)
    SWAP_USO=$(free | awk '/Swap:/ {
        if ($2 == 0)
            printf "0.0";
        else
            printf "%.1f", ($3/$2)*100
    }')

    printf '%s;%s;%s;%s;%s\n' \
        "$DATA_HORA" "$TEMP" "$CPU_USO" "$RAM_USO" "$SWAP_USO" >> "$LOGFILE"

    sleep "$INTERVALO"
done
