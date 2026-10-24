# Mods para Claude Code

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Português](README.pt-BR.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

## plan-progress

Barras de progreso en vivo sobre el campo de entrada de Claude Code. Claude divide la tarea en etapas y pasos, y la barra avanza a medida que trabaja. Los subagentes de cada tarea aparecen debajo de su barra.

![plan-progress: dos tareas con sus agentes, una pregunta, un error, un plan reescrito a mitad de camino, ambas tareas terminadas](media/plan-progress.gif)

[Ver con sonido (MP4, 14 s)](media/plan-progress.mp4)

- Una fila por tarea: estado, título, barra, porcentaje, botón de cierre
- La etiqueta de la barra muestra la etapa y el paso actuales; al pasar el cursor, el tiempo transcurrido
- Las etapas son cápsulas y los pasos, puntos; al pasar el cursor sobre uno ya superado se ve cuánto tardó, y sobre uno por delante, qué empieza ahí
- Una barra terminada se vuelve verde, muestra el tiempo total y se queda hasta que se cierra; con `/plan-progress-autoclose` activado, desaparece tras `doneBarSeconds` (30 s por defecto, en `/config`)
- Los puntos del relleno y de las filas de subagentes centellean; desactiva `twinkle` en `/config` para dibujarlos quietos
- Cuatro estados: en curso, requiere respuesta, error, terminado
- Cada subagente tiene una fila bajo su tarea: nombre, modelo y effort, herramienta actual, tiempo
- El plan puede cambiar durante el trabajo; los pasos completados se conservan por título
- Las barras se guardan por sesión y vuelven al reanudarla
- Sonidos breves ante una pregunta, un error y al terminar
- El pie muestra a qué velocidad escribe la conversación principal, `⚡ N tok/s`; los subagentes no cuentan
- El ⚙ a su lado (en la app de escritorio y en la terminal a pantalla completa) abre una ventana de ajustes: efectos, cierre automático y sus segundos, sonidos, la propia cifra, la versión del mod y la búsqueda de actualizaciones; `/plan-progress-settings` la abre en cualquier lugar. La ventana usa el idioma de `/config`; si no, el de la app o el del sistema
- Actualizaciones: al pulsar la versión en la ventana de ajustes se busca una versión nueva, y «Actualizar» la instala y recarga el mod en el momento (si la recarga no surte efecto, pide reiniciar). Cada 6 horas el mod también lo comprueba por su cuenta y marca el ⚙ con 🔹 (● en la terminal) cuando hay una versión nueva. Cada comprobación es una sola petición a la API de GitHub (`api.github.com/repos/zycck/claude-mods/releases`), sin datos de la cuenta ni de la sesión; se desactiva con «Buscar actualizaciones» en la ventana o con `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Una copia instalada desde una carpeta no se comprueba
- Funciona en la app de escritorio y en la terminal
- En la terminal la barra sigue el modo claro u oscuro de GNOME con el tema `auto` y toma los colores del tema activo de Omarchy

### Instalación

Requiere Claude Code 2.1.295 o posterior (`claude --version`; actualiza con `claude update`). En versiones anteriores parte del mod no funciona: la ventana de ajustes queda vacía y, antes de la 2.1.286, el módulo de hooks ni siquiera se carga, no aparece ninguna barra y al iniciar se muestra `plan-progress: hooks module did not load`.

```
/plugin marketplace add zycck/claude-mods
/plugin install plan-progress@zycck-mods
```

Actualización:

```
claude plugin marketplace update zycck-mods
claude plugin update plan-progress@zycck-mods
```

### Comandos

- `/progress` muestra u oculta las barras
- `/progress-clear` elimina todas las barras
- `/progress-agents` pliega las franjas de agentes bajo las barras o las vuelve a mostrar (el botón de flecha junto a la ✕ de una barra lo hace solo para esa barra)
- `/plan-progress-autoclose` activa el cierre automático de las barras terminadas (desactivado por defecto) o lo vuelve a desactivar; la elección se mantiene entre sesiones
- `/plan-progress-settings` abre la ventana de ajustes, como el ⚙ del pie (en la terminal el ⚙ solo aparece a pantalla completa)

### Cómo funciona

El mod registra la herramienta `plan_progress`. Claude envía el plan una vez y luego actualizaciones breves como `{id, next: true}` o `{id, done: ["Routes"]}`. Un nombre de paso desconocido se rechaza con la lista de pasos de la barra. Un plan aprobado en plan mode se convierte en la barra `plan`. Las filas de agentes salen de los eventos del motor y no gastan tokens.

En la app de escritorio la barra es una imagen SVG con una capa para el cursor encima. En la terminal es una cuadrícula de caracteres que solo se anima mientras Claude trabaja.

### Pruebas

`plugins/plan-progress/tests` ejecuta el módulo real sobre un motor simulado: `node compile.cjs ../hooks/register.tsx register.mjs` y luego `node regress.mjs` y `node scenarios.mjs`.

## Licencia

MIT
