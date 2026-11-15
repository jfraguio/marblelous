# MARBLELOUS
## Especificación de producto y técnica — v1.0

| Campo | Valor |
|---|---|
| Proyecto | Marblelous — taller infinito de canicas |
| Documento | Especificación funcional + técnica |
| Versión | 1.0 (para revisión) |
| Fecha | 15 de noviembre de 2026 |
| Plataforma | Web estática, GitHub Pages, iPad-first |
| Estado | **Pendiente de aprobación.** No se ha escrito código de producción. |
| Autor | Equipo de diseño/ingeniería |

> **Actualización v1.1 (implementada).** El juego ya no tiene tienda: todas las piezas y canicas están disponibles desde el inicio. La colocación es de dos toques (pieza de la bandeja → lienzo), una pieza por selección, con botón flotante de duplicado. Se añadieron caída en espiral musical, burbujas que estallan con más de 10 canicas, portales dobles, ventilador de aire y propulsión reforzada. “Borrar canvas” sustituye al reinicio de progreso. Las secciones de tienda y economía de compra del resto del documento quedan superadas por esta nota; el resto sigue vigente como referencia de diseño.

> **Cómo leer este documento.** Las secciones 1–6 describen el producto (qué se juega y cómo se siente). Las secciones 7–12 describen la implementación (cómo se construye y se optimiza). Las secciones 13–18 son compatibilidad, calidad, privacidad, riesgos, plan y decisiones pendientes. Todo lo marcado como **[decisión abierta]** necesita tu visto bueno antes de implementar.

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Visión, pilares y público](#2-visión-pilares-y-público)
3. [Bucle de juego y progresión](#3-bucle-de-juego-y-progresión)
4. [Sistemas de juego](#4-sistemas-de-juego)
5. [Catálogo de piezas y canicas](#5-catálogo-de-piezas-y-canicas)
6. [Interfaz, gestos y experiencia táctil](#6-interfaz-gestos-y-experiencia-táctil)
7. [Dirección de arte](#7-dirección-de-arte)
8. [Dirección de audio](#8-dirección-de-audio)
9. [Arquitectura técnica](#9-arquitectura-técnica)
10. [Motor de física](#10-motor-de-física)
11. [Renderizado y optimización](#11-renderizado-y-optimización)
12. [Persistencia y datos](#12-persistencia-y-datos)
13. [Compatibilidad iOS/Safari](#13-compatibilidad-iossafari)
14. [Calidad, pruebas y criterios de aceptación](#14-calidad-pruebas-y-criterios-de-aceptación)
15. [Privacidad, legal y accesibilidad](#15-privacidad-legal-y-accesibilidad)
16. [Riesgos](#16-riesgos)
17. [Plan de implementación](#17-plan-de-implementación)
18. [Decisiones abiertas para revisión](#18-decisiones-abiertas-para-revisión)
19. [Anexos](#19-anexos)

---

## 1. Resumen ejecutivo

**Marblelous** es un juguete digital de construcción con canicas para iPad. El jugador dispone de un lienzo 2D infinito donde coloca piezas con estética de bloques de juguete —ladrillos, rampas, trampolines, bucles, xilófonos, propulsores— y después suelta canicas desde cualquier punto para ver qué ocurre. La física hace el resto: la canica rueda, choca, suena, vuela y vuelve a caer. Cada colisión contra una lámina de xilófono produce una nota afinada, de modo que cualquier máquina construida por un niño de 8 años suena musical sin necesidad de saber música.

No hay niveles, ni vidas, ni cronómetros, ni texto innecesario. Hay un lienzo, piezas, canicas, sonido y una economía amable de **chispas** que se ganan haciendo cosas espectaculares y se gastan en desbloquear más piezas y más canicas. El juego premia la curiosidad y el espectáculo, no la eficiencia.

**Decisiones técnicas principales:**

- **Puro front**: HTML + CSS + TypeScript, compilado con Vite, sin dependencias de runtime, desplegado como sitio estático en GitHub Pages.
- **Canvas 2D** con sprites pre-renderizados, no WebGL: la escena es 2D, el número de dibujos es bajo y Canvas 2D es más predecible en Safari/iPad antiguos.
- **Motor de física propio**, 2D, paso fijo a 120 Hz, colisionadores de cápsula, substeps adaptativos, sleeping y broadphase espacial. Diseñado para 200 canicas y escenarios de ~2.000 piezas, con calidad adaptativa para sostener 60 fps (30 fps como red de seguridad).
- **Audio 100 % sintetizado** con Web Audio API: cero archivos de audio, cero descargas, sonido limpio y afinado, con límite de voces y compresor de salida.
- **Cero assets de imagen en el juego**: toda la estética se genera por código (sprites en canvas), lo que mantiene el bundle por debajo de ~120 KB y el arranque por debajo de 1 s. Los únicos PNG son los iconos de instalación de la PWA, generados una vez.
- **Persistencia local** en `localStorage` con esquema versionado, autosave y exportación opcional.
- **PWA offline**: tras la primera visita, el juego funciona sin red.

**Éxito del producto (medible):**

- Un niño de 8 años construye una rampa, suelta una canica y oye una nota **en menos de 60 segundos**, sin ayuda y sin leer.
- 60 fps estables en iPad de 6.ª generación con 100 canicas y 800 piezas visibles; degradación elegante a 30 fps si el dispositivo no da más.
- Sesiones objetivo de 10–25 minutos, sin pantallas de derrota ni fricción de inicio.
- La primera sesión permite comprar al menos una pieza nueva.
- Cero peticiones de red después de la carga; cero datos personales.

---

## 2. Visión, pilares y público

### 2.1 Fantasía central

> **“Construyo una máquina, suelto una canica y descubro lo que pasa.”**

El jugador es un inventor. No hay un objetivo único ni una forma “correcta” de jugar. El placer viene de la **causalidad visible**: coloco esto, suelto aquello, y ocurre una reacción en cadena que suena bien y luce bien. La pantalla es un juguete de mesa, no un videojuego de niveles.

### 2.2 Pilares de diseño

| Pilar | Qué significa en la práctica | Cómo se verifica |
|---|---|---|
| **Construir es tan divertido como jugar** | Colocar, mover, rotar y borrar piezas se siente instantáneo, preciso y táctil. Nada de menús profundos. | Una pieza se coloca en < 2 gestos; el 90 % de las acciones no requiere más de 1 toque. |
| **Todo suena bien** | Escala pentatónica, síntesis cuidada, mezcla suave. Es imposible “hacer ruido feo”. | Cualquier secuencia aleatoria de notas es agradable; ninguna combinación satura ni distorsiona. |
| **Se premia el espectáculo, no la eficiencia** | Más puntos por bucles, vuelos, cadenas y locuras que por “terminar”. | El jugador gana más experimentando que repitiendo la misma jugada. |
| **Cero fricción, cero texto** | Iconos, pictogramas, fantasmas animados y sonido. Los números son el único texto esencial. | El bucle principal se completa sin leer una sola palabra. |
| **Silencio visual y 60 fps** | Colores planos, sombras mínimas, cero efectos caros, cero ruido decorativo. | Presupuesto de frame y de memoria cumplidos en dispositivo objetivo. |
| **Nada se rompe** | No hay estados de fallo. Si una canica cae al vacío, desaparece con una transición suave. Si algo se borra, hay deshacer. | Cero pantallas de error; recuperación automática de guardado corrupto. |

### 2.3 Público objetivo

- **Primario:** niños y niñas de 8 a 12 años con iPad. Lectores incipientes o fluidos; el juego no exige lectura.
- **Secundario:** adultos que juegan con ellos (padres, hermanos mayores). La estética no es infantilista: puede quedar bien en la mesa del salón.
- **Contexto de uso:** sesiones cortas en casa, coche, viajes; a veces con auriculares, a veces sin ellos. iPad en horizontal la mayor parte del tiempo, también en vertical.
- **Habilidad digital:** alta familiaridad con gestos táctiles, baja tolerancia a menús, textos y esperas.

### 2.4 Qué NO es

- No es un juego de plataformas ni de acción con tiempo límite.
- No hay personajes, mascotas, diálogos ni narrativa.
- No hay niveles diseñados por el equipo que haya que superar en orden.
- No hay multijugador, cuentas, nube, publicidad, compras reales ni analítica.
- No hay música de fondo (decisión explícita; el sonido es diegético y musical).
- No es un editor de físicas profesional: no se editan colisionadores a mano ni se programan comportamientos.

### 2.5 Referencias de tono (no de copia)

- La libertad causal de **The Incredible Machine**.
- La lectura inmediata de **Marble Madness**.
- La calidad táctil y la ausencia de texto de **Toca Boca**.
- La contención cromática y el acabado de **Monument Valley** / **LEGO Architecture**.
- La satisfacción física de un **xilófono de madera** y de una máquina de canicas de museo.

Ninguna referencia se copia: nombre, iconos, piezas, paleta y sonidos serán originales.

### 2.6 Alcance priorizado

| Prioridad | Incluye | Criterio |
|---|---|---|
| **P0 — v1.0** | Lienzo infinito con pan/zoom; construcción completa (colocar, mover, rotar, borrar, deshacer); ladrillos, placas, rampas, trampolín, bucle, medio tubo, embudo, cinta, propulsor, cañón, parachoques, estrella, meta e imán; xilófonos 3/5/8 y lámina suelta; 5 canicas; física con cápsulas, substeps y sueño; audio sintetizado; puntos, combo y chispas; tienda; 12 retos; 3 mundos; autosave; tutorial sin texto; PWA offline; calidad adaptativa; táctil + ratón/teclado; accesibilidad básica. | Es jugable, completo y vendible como v1. |
| **P1 — v1.1** | Portal, meta dorada, balancín; exportar/importar mundos; temas de papel y colores extra; replays de tiradas; seguimiento opcional de canica. | Amplía el juguete sin tocar el núcleo. |
| **P2 — futuro** | Molinete; enlaces para compartir un mundo; retos por fecha local; efectos de agua/arena; multijugador local por turnos (si alguna vez). | Solo si la v1 demuestra retención. |
| **Fuera de alcance** | Cuentas, nube, publicidad, compras reales, editor de niveles con texto, narrativa, música de fondo, realidad aumentada. | No se implementan. |

---

## 3. Bucle de juego y progresión

### 3.1 Bucle central

```
        ┌──────────────────────────────────────────┐
        │                                          │
        ▼                                          │
  CONSTRUIR  ──►  SOLTAR CANICA  ──►  ESPECTÁCULO  ──►  CHISPAS
  (piezas)        (desde donde    (sonido, vuelo,      (moneda)
                   quieras)        cadena, meta)
        ▲                                          │
        │                                          ▼
        └────────────  DESBLOQUEAR  ◄────────  TIENDA
                     (piezas/canicas)
```

El bucle no tiene final ni “victoria”. La progresión es una **colección** que amplía el vocabulario creativo: cada compra abre nuevas posibilidades de construcción. Los récords y retos añaden metas opcionales sin presionar.

### 3.2 Sesión típica (10–20 min)

1. **0:00** — Abre la app. Cae directamente en su mundo, sin menú de título. La primera vez, el mundo arranca con un andamiaje mínimo ya colocado (rampa, xilófono 3 y campana) para que la primera canica suene de inmediato; las sesiones siguientes conservan lo construido.
2. **0:10** — Suelta una canica con un toque. Rueda, golpea una lámina, suena un Do. Aparecen chispas y una pequeña celebración.
3. **1:00** — Construye una rampa más larga, prueba un trampolín. Encadena tres notas. Sube el combo.
4. **5:00** — Abre la tienda, compra una rampa curva o un trampolín. Lo coloca y lo prueba.
5. **10:00** — Intenta un bucle. Falla varias veces, añade un propulsor, lo consigue. Aplausos visuales y +60.
6. **15:00** — Limpia las canicas, amplía el escenario hacia la derecha, guarda automáticamente y cierra.
7. **Próxima sesión** — Todo sigue donde lo dejó; el mundo puede crecer indefinidamente.

**Arranque:** el HTML y el CSS crítico se cargan inline; el canvas aparece de inmediato con el color de papel y la cámara guardada. Los sprites se generan de forma perezosa. No hay splash de más de 300 ms ni pantalla de carga bloqueante; si el guardado tarda, se muestra una canica girando discreta en una esquina.

### 3.3 Curva de aprendizaje y maestría

| Fase | Tiempo | Qué descubre | Piezas disponibles |
|---|---|---|---|
| **Descubrimiento** | 0–3 min | Soltar canicas, oír notas, ganar chispas. | Ladrillos, rampa recta, xilófono 3, campana, canica de cristal. |
| **Experimentación** | 3–15 min | Rampas curvas, trampolín, cadenas, combo. | + rampa curva, trampolín, estrella, xilófono 5. |
| **Construcción** | 15–45 min | Bucles, propulsores, embudos, cintas, metas múltiples. | + bucle, propulsor, embudo, cañón, cinta. |
| **Maestría** | 45 min+ | Máquinas grandes, portales, imanes, canicas especiales, récords. | Catálogo completo. |

La maestría no se mide por puntuación, sino por **vocabulario**: el jugador aprende a combinar piezas para crear efectos que antes no sabía que existían.

### 3.4 Estructura de metas (sin presión)

- **Metas implícitas:** “¿Qué pasa si…?”. El propio sistema físico responde.
- **Retos ilustrados:** 12 tarjetas con pictogramas y un número (p. ej., icono de bucle ×3). Aportan chispas extra y una medalla. Son opcionales y no bloquean nada.
- **Récords personales:** mejor combo, mayor velocidad, vuelo más largo, más canicas a la vez, mejor tirada. Se muestran con iconos y números.
- **Colección:** piezas y canicas desbloqueadas; la tienda es el “álbum”.

No hay misiones diarias, energía, vidas, anuncios ni recompensas por esperar. Todo lo que se gana se gana jugando.

---

## 4. Sistemas de juego

### 4.1 Modos

Hay dos modos, conmutables con un único control grande y siempre visible:

| Modo | Icono | Qué hace el toque en el lienzo | Bandeja inferior |
|---|---|---|---|
| **Construir** | Ladrillo | Arrastra para mover la cámara; toca una pieza para seleccionarla; arrastra una pieza para moverla. | Piezas desbloqueadas + acceso a tienda. |
| **Jugar** | Canica | Toca para soltar una canica en ese punto (con fantasma previo); arrastra para mover la cámara. | Canicas desbloqueadas + acceso a tienda. |

La física **nunca se detiene** al cambiar de modo: las canicas que ya están rodando siguen rodando. Los overlays (tienda, retos, ajustes, pausa) sí congelan la simulación para evitar puntuaciones y sonidos en segundo plano.

### 4.2 Construcción

**Colocar una pieza**

1. El jugador toca una pieza de la bandeja y arrastra sin soltar.
2. Aparece un fantasma semitransparente de la pieza sobre el lienzo, siguiendo el dedo.
3. La posición se imanta a una rejilla de **20 u** (la mitad de un ladrillo). La rotación se imanta a **15°**, con imanes especiales en 0°, 45°, 90°.
4. Al soltar sobre el lienzo, la pieza se coloca con una animación de escala de 120 ms y un clic suave.
5. Si se suelta fuera del lienzo o sobre un control, la pieza vuelve a la bandeja sin colocarse (sin sonido de error).

**Seleccionar, mover, rotar, borrar**

- Tocar una pieza la selecciona: aparece un contorno discontinuo y tres controles flotantes: **rotar** (arco superior), **duplicar** (opcional) y **borrar** (papelera).
- Arrastrar una pieza seleccionada (o directamente cualquier pieza) la mueve con la misma rejilla.
- El control de rotar se arrastra en círculo; los imanes de 15° ayudan a alinear sin precisión milimétrica.
- La papelera flotante borra. También se puede arrastrar la pieza a una zona de papelera que aparece abajo a la derecha mientras se arrastra.
- **Deshacer** y **rehacer** están siempre disponibles (flechas), con hasta 100 acciones. Borrar el mundo entero también es deshacible; limpiar canicas no.

**Rampas ajustables**

- Las rampas rectas tienen un tirador en el extremo que permite alargar/acortar su longitud en pasos de 40 u, entre 80 y 240 u.
- El tirador solo aparece con la pieza seleccionada; no añade ruido visual.

**Colores**

- Los ladrillos, placas y rampas admiten **6 colores** de una paleta fija. El color se elige en la bandeja (fila de muestras) y se aplica a las piezas nuevas y a la seleccionada.
- Las piezas funcionales (trampolín, bucle, propulsor, xilófono, meta, etc.) conservan su color de identidad para que el escenario se lea de un vistazo. Esto es deliberado: el color comunica función.

**Límites y comportamiento**

- Máximo **2.000 piezas** por mundo (límite blando). Al acercarse, un contador con icono de ladrillo aparece discretamente; al llegar, el fantasma vibra y no se coloca (sin texto, con sonido suave de tope).
- Las piezas pueden solaparse; no hay validación estructural. Es un juguete, no un simulador de ingeniería.
- No hace falta apilar sobre una base: todo puede flotar.
- Las piezas no se mueven durante la simulación en v1 (excepto el balancín, previsto para v1.1). Por eso sus colisionadores se precalculan y no cuestan nada por frame.

### 4.3 Canicas y lanzamiento

- En modo Jugar, la bandeja muestra las canicas desbloqueadas. La seleccionada tiene un anillo.
- **Tocar** el lienzo: aparece un fantasma de canica en el punto tocado; al levantar el dedo, se suelta con velocidad inicial cero. Si el dedo se desplaza más de 10 px, el gesto se interpreta como desplazamiento de cámara y no se suelta canica.
- **Mantener pulsado** más de 350 ms inicia una lluvia de canicas a un máximo de **8 por segundo**, con un retardo de 120 ms entre ellas; al levantar se detiene. Si el dedo se desplaza más de 10 px, la lluvia se cancela y el gesto pasa a ser desplazamiento de cámara. El objetivo es poder hacer “lluvia de canicas” sin inundar el dispositivo.
- Se puede soltar en cualquier punto del mundo, incluso muy por encima de las piezas. La gravedad se encarga.
- **Tope de 200 canicas vivas** (activas + dormidas). Al superarlo, la más antigua se desvanece en 200 ms y se elimina. Las canicas que llegan a una meta también se eliminan con una animación. De esas 200, como máximo 80 pueden estar dormidas; por encima, se retiran las más antiguas.
- **Limpieza:** botón de escoba que desvanece todas las canicas. No pide confirmación (son gratuitas), pero muestra un resumen de la tirada.

**Sensación de lanzamiento**

- La canica aparece con una animación de escala 0 → 1 en 80 ms.
- Si se suelta sobre una pieza, no hay colisión inicial brusca: se resuelve en el primer paso físico.
- Mientras se mantiene el dedo, una guía vertical punteada muy tenue (24 u) ayuda a apuntar; desaparece al soltar.

### 4.4 Física (resumen funcional)

La física es la protagonista y debe ser **legible, predecible y espectacular**:

- Gravedad constante hacia abajo.
- Canicas esféricas con radio, masa, rebote y fricción propios.
- Superficies de colisión tipo cápsula (segmento con grosor), lo que permite rampas, curvas, bucles y embudos suaves con muy poco coste.
- Colisiones canica-canica reales (se empujan, se transmiten impulso), con límite de pares por frame.
- Rebote dependiente del material: ladrillo seco, trampolín elástico, acero pesado, goma saltarina.
- Resistencia a la rodadura para que las canicas se detengan de forma natural y puedan dormir.
- Propulsores que aceleran mientras la canica está dentro; cañones que dan un impulso único; cintas que arrastran; imanes que atraen; portales que teletransportan.
- Sin pérdida de energía inexplicable ni “pegado” a las paredes: la sensación debe ser la de una canica de verdad, ligeramente exagerada.

Detalle matemático completo en la [sección 10](#10-motor-de-física).

### 4.5 Xilófono y música

- Las láminas de xilófono son colisionadores sólidos con material `chime`. Al recibir un impacto con velocidad normal suficiente, reproducen una nota y emiten una chispa visual.
- Las notas siguen una **escala pentatónica de Do mayor** (Do, Re, Mi, Sol, La) en dos octavas. Cualquier combinación suena bien; no hay notas “disonantes”.
- La altura de la nota depende de la lámina (índice 0–7), no de la fuerza. La fuerza modula volumen y brillo, no afinación.
- Cada lámina tiene un color propio dentro de una gradiente cálida (madera clara → ámbar → coral), de modo que el jugador puede leer la altura sin texto.
- Los impactos muy seguidos sobre la misma lámina suenan (con intensidad reducida) pero no puntúan, para evitar granjas de puntos.
- El xilófono es también un elemento de construcción: sus láminas son rampas/obstáculos. Se puede construir una “escalera musical”, una “caja de música” o una máquina que toque una melodía al pasar.

**Escala y frecuencias** (detalle en anexo B):

| Índice | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Nota | Do4 | Re4 | Mi4 | Sol4 | La4 | Do5 | Re5 | Mi5 |
| Hz | 261,63 | 293,66 | 329,63 | 392,00 | 440,00 | 523,25 | 587,33 | 659,25 |

### 4.6 Puntuación, cadena y chispas

Hay una sola moneda, **chispas (✦)**, que es a la vez marcador y moneda de la tienda. No hay puntuación separada que confunda.

**Eventos que otorgan chispas**

| Evento | Chispas base | Límite / matiz |
|---|---:|---|
| Golpe en lámina de xilófono | 5 | Sin puntos si la misma lámina se golpea en < 120 ms. |
| Rebote en trampolín | 8 | Máximo 1 por canica cada 400 ms. |
| Uso de propulsor | 2 | Una vez por canica y propulsor cada 500 ms. |
| Bucle completado (≥ 300° de giro) | 60 | Una vez por canica y bucle cada 3 s. |
| Canica en la campana/meta | 120 | La canica se elimina. |
| Estrella recogida | 15 | Una vez por canica y estrella cada 5 s. |
| Vuelo largo | 20 por segundo a partir de 1,2 s | Máximo 60 por vuelo. |
| Récord personal batido | 200 | Solo la primera vez que se bate cada tipo de récord. |
| Reto completado | 300–750 | Una vez. |

**Cadena y multiplicador**

- Cada evento puntuable incrementa la **cadena**.
- El multiplicador es `1 + 0,25 × floor(cadena / 5)`, con techo **×5**.
- La cadena se rompe si pasan **2,5 s** sin eventos puntuables.
- El multiplicador se muestra en un anillo junto al contador de chispas; no hay texto explicativo.
- Los eventos de sonido no puntuables (misma lámina repetida) no rompen la cadena, pero tampoco la aumentan.

**Puntos por tirada**

```
puntos_tirada = Σ (base_evento × multiplicador_en_ese_momento × bonus_canica)
```

- `bonus_canica`: cristal 1,0; goma 1,0; acero 1,05; cometa 1,15; plasma 1,3.
- No hay penalización por fallar ni por limpiar.
- Al terminar una tirada (todas las canicas dormidas o eliminadas), se muestra un **resumen icónico** de 4 s: chispas ganadas, notas, bucles, distancia. Sin texto.

**Anti-granja**

- Cooldowns por canica/pieza descritos arriba.
- Los golpes repetidos de la misma lámina en < 120 ms no puntúan.
- Los bucles solo puntúan si la canica ha recorrido ≥ 300° reales dentro del anillo.
- No hay puntos pasivos por tiempo.

### 4.7 Tienda y economía

**Principios**

- Todo se compra con chispas ganadas jugando. No hay moneda premium, anuncios ni espera.
- La tienda muestra **previsualizaciones renderizadas con el mismo motor** que el juego, no iconos genéricos.
- No hay nombres de producto: imagen + precio + estado. La accesibilidad se cubre con `aria-label`.
- Dos pasos para comprar: tocar la tarjeta (se expande) y tocar el botón de check. Evita compras accidentales.
- Si no hay saldo, el precio vibra suavemente y suena un tono grave muy corto; no hay mensaje de error.
- Las tarjetas asequibles tienen un punto luminoso discreto; la tarjeta de tienda de la bandeja también brilla cuando hay algo comprable.

**Previsualización de compra**

- La tarjeta expandida muestra la pieza en movimiento (una pequeña animación de 2 s: una canica la recorre o la pieza late) y su precio.
- Comprar: la tarjeta se encoge, vuela hacia la bandeja y la bandeja brilla. Sonido de compra de dos notas.
- Las piezas compradas se añaden al final de la bandeja (ordenadas por categoría y precio).

**Ritmo económico objetivo**

| Momento | Chispas acumuladas esperadas | Qué puede comprar |
|---|---:|---|
| 1 min | 150–300 | Trampolín o rampa curva. |
| 5 min | 600–1.000 | 2–3 piezas de nivel 1. |
| 15 min | 1.500–2.500 | Bucle + xilófono 5 + propulsor. |
| 45 min | 4.000–6.000 | Cañón, cinta, meta extra, canica de acero. |
| 2–3 h | Catálogo completo + retos | Todo. |

La economía se ajusta con pruebas reales, no con fórmulas cerradas. La tabla de precios está en la sección 5.

### 4.8 Retos y medallas

12 retos opcionales, accesibles desde el icono de trofeo. Cada uno se explica con **pictogramas animados y un número**, sin párrafos.

| # | Reto | Pictograma | Objetivo | Recompensa |
|---:|---|---|---|---:|
| 1 | Primer viaje | canica → campana | 1 canica en la meta | 300 |
| 2 | Escalera musical | 5 notas distintas | 5 notas distintas en una tirada | 500 |
| 3 | El bucle | bucle ×1 | Completar un bucle | 500 |
| 4 | Vuelo | canica con alas | 2 s de vuelo | 400 |
| 5 | Cama elástica | trampolín ×8 | 8 rebotes en una tirada | 400 |
| 6 | Constructor | ladrillo ×50 | Colocar 50 piezas | 300 |
| 7 | Lluvia | canica ×20 | 20 canicas activas a la vez | 450 |
| 8 | Diana | campana ×10 | 10 canicas en metas | 600 |
| 9 | Combo | ×4 | Alcanzar multiplicador ×4 | 600 |
| 10 | Cohete | velocidad | Alcanzar 2.500 u/s | 500 |
| 11 | Torre | ladrillos apilados | 25 ladrillos en el mundo | 350 |
| 12 | Maratón | chispa ×10.000 | Ganar 10.000 chispas totales | 750 |

- El progreso se guarda y se muestra con un anillo alrededor del pictograma.
- Completar un reto muestra una medalla estampada, un acorde y un pequeño estallido. No hay texto.
- Los retos no bloquean piezas; solo dan chispas y prestigio.
- Los récords (mejor combo, velocidad, vuelo, canicas simultáneas, mejor tirada) se guardan por mundo y se muestran en la misma pantalla con iconos.

### 4.9 Onboarding sin texto

La primera sesión incluye un tutorial de **4 pasos**, de 60–90 segundos, con manos fantasma y guías punteadas:

1. **Arrastra un ladrillo** de la bandeja al lienzo (el ladrillo fantasma sigue a una mano animada).
2. **Coloca una rampa** debajo (gesto de arrastre y giro).
3. **Suelta una canica** desde arriba (cambio de modo automático sugerido con un pulso; la canica fantasma cae y golpea el xilófono).
4. **Celebra y abre la tienda** (las chispas vuelan hacia el contador; el icono de tienda late).

- Cualquier interacción avanza el paso; el tutorial se puede omitir tocando la esquina.
- Si el jugador construye 5 piezas sin lanzar una canica, aparece un pulso en el botón de canica.
- Si pasan 20 s sin interacción, un pulso muy sutil señala la siguiente acción.
- El tutorial se puede repetir desde ajustes.
- No hay texto en ningún paso; solo iconos, fantasmas y sonido.

### 4.10 Mundos y sesión

- **3 mundos** (“cuadernos”) por perfil, con un punto de color para identificarlos. Se cambia desde ajustes; el mundo activo se guarda.
- Cada mundo tiene su propio escenario, sus récords y su cámara.
- No hay nombres de mundo (solo color); evita texto y mantiene la interfaz limpia.
- Al abrir la app se carga el último mundo activo, directamente, sin pantalla de título.
- El mundo es efectivamente infinito: se puede desplazar la cámara y hacer zoom sin límites prácticos (±100.000 u). El límite real es de 2.000 piezas y el almacenamiento del dispositivo.

---

## 5. Catálogo de piezas y canicas

### 5.1 Convenciones

- **u** = unidad de mundo. A zoom 1, 1 u ≈ 1 px CSS. La rejilla fina es de 20 u; el módulo de ladrillo es 80 × 40 u.
- **Precio** en chispas. `—` = incluida desde el inicio.
- **Material** determina rebote, fricción, sonido y color funcional.
- **v1** = lanzamiento; **v1.1** = primera actualización; **v2** = futuro.
- Todas las piezas son estáticas en v1 salvo las marcadas como dinámicas.

### 5.2 Piezas de construcción

| Pieza | ID | Tamaño | Comportamiento | Material | Precio | Versión |
|---|---|---|---|---|---:|---|
| Ladrillo 2×1 | `brick2` | 80 × 40 | Sólido, 2 tetones visuales. Color a elegir. | `brick` | — | v1 |
| Ladrillo 4×1 | `brick4` | 160 × 40 | Sólido, 4 tetones. Color a elegir. | `brick` | — | v1 |
| Placa 4×1 | `plate4` | 160 × 20 | Sólido fino, 4 tetones. Color a elegir. | `brick` | 100 | v1 |
| Rampa recta | `ramp` | 160 × 12 (longitud 80–240) | Sólido inclinable, longitud ajustable. Color a elegir. | `brick` | — | v1 |
| Rampa curva | `rampCurve` | radio 100, 90° | Cuarto de tubo, 24 cápsulas. Color a elegir. | `brick` | 250 | v1 |
| Trampolín | `trampoline` | 120 × 12 | Rebote 0,92, se aplasta al impacto. | `rubber` | 300 | v1 |
| Bucle (loop) | `loop` | radio 80, arco 320° | Anillo de 64 cápsulas con entrada inferior; la canica rueda por dentro. | `loop` | 700 | v1 |
| Medio tubo | `halfPipe` | radio 90, 180° | Curva en U de 40 cápsulas. | `brick` | 800 | v1 |
| Embudo | `funnel` | 180 × 140 | Dos arcos convergentes; canaliza canicas. | `brick` | 550 | v1 |
| Cinta transportadora | `conveyor` | 160 × 12 | Arrastra tangencialmente a 220 u/s; flechas animadas. | `conveyor` | 900 | v1 |
| Balancín | `seesaw` | 160 × 12 | Dinámico, 1 grado de libertad; vuelca con el peso. | `brick` | 1.200 | v1.1 |
| Molinete | `spinner` | 140 × 140 | Barra giratoria kinemática; lanza canicas. | `metal` | 1.500 | v2 |

### 5.3 Piezas musicales

| Pieza | ID | Tamaño | Comportamiento | Material | Precio | Versión |
|---|---|---|---|---|---:|---|
| Xilófono 3 | `xylo3` | 3 láminas, 240 × 60 | 3 notas (0–2); base decorativa. | `chime` | — | v1 |
| Lámina suelta | `chimeBar` | 60–120 × 14 | 1 nota; se coloca y rota libremente. | `chime` | 150 | v1 |
| Xilófono 5 | `xylo5` | 5 láminas, 360 × 60 | 5 notas (0–4). | `chime` | 650 | v1 |
| Xilófono 8 | `xylo8` | 8 láminas, 520 × 60 | 8 notas (0–7), dos octavas. | `chime` | 1.100 | v1 |

Las láminas de un xilófono son a la vez superficie de rodadura y sensor de nota. La base no colisiona (solo las láminas).

### 5.4 Piezas de energía y juego

| Pieza | ID | Tamaño | Comportamiento | Material | Precio | Versión |
|---|---|---|---|---|---:|---|
| Propulsor | `booster` | 80 × 80 (zona) | Acelera en su dirección mientras la canica está dentro; +2.600 u/s máx. | `energy` | 600 | v1 |
| Cañón | `cannon` | 80 × 20 | Impulso único al contacto (1.800 u/s) con cooldown 300 ms. | `energy` | 1.000 | v1 |
| Parachoques | `bumper` | radio 28 | Rebote 0,92 con tope de velocidad; suena y da puntos. | `rubber` | 850 | v1 |
| Estrella | `star` | radio 16 | Trigger coleccionable; +15 y destello. Reaparece a los 5 s. | `trigger` | 350 | v1 |
| Campana / meta | `goal` | 96 × 96 | Trigger de meta; +120, confeti, la canica desaparece. | `trigger` | — | v1 |
| Imán | `magnet` | radio 180 (campo) | Atrae canicas con fuerza radial decreciente. | `field` | 1.400 | v1 |
| Portal | `portal` | radio 24 | Pareja A/B; teletransporta conservando velocidad. Cooldown 350 ms. | `field` | 2.000 | v1.1 |
| Meta dorada | `goalGold` | 96 × 96 | Meta premium: +250 y explosión de confeti. | `trigger` | 2.500 | v1.1 |

**Notas de diseño por pieza**

- **Bucle:** la entrada está abajo a la derecha (40° de abertura) para que se pueda entrar rodando. El jugador debe aprender que hace falta velocidad; el propio fracaso enseña. Un propulsor antes del bucle es la solución natural. La pieza incluye una flecha sutil en la entrada.
- **Propulsor:** visual de tres chevrones animados en la dirección; solo actúa dentro del cuadrado. No es un colisionador.
- **Cañón:** visual de resorte; se comprime 90 ms al disparar. El impulso es perpendicular a la base, en la dirección de la flecha.
- **Trampolín:** se aplasta a 0,85 de escala vertical durante 90 ms; suena un “boing” sintetizado. Rebote casi perfecto pero con tope de velocidad para no romper la física.
- **Cinta:** las flechas se mueven; la canica acelera tangencialmente hasta 220 u/s. No da puntos por sí sola (evita granjas).
- **Estrella:** no colisiona, es un trigger. Se puede colocar en el aire. Es la pieza perfecta para premiar trayectorias.
- **Campana:** tiene una boca amplia para que sea fácil acertar; es la meta básica y está disponible desde el inicio para cerrar el bucle de recompensa.
- **Imán:** atrae con fuerza suave; puede crear órbitas espectaculares. No da puntos por sí solo. Un anillo visual late cuando hay canicas cerca.
- **Portal:** conserva la velocidad y la rota según la orientación del portal de salida. Los pares se crean automáticamente al colocar el segundo portal; se enlazan por proximidad o por orden. Se desactiva 350 ms tras cada uso para evitar bucles infinitos de teletransporte.
- **Balancín y molinete:** requieren cuerpos con grado de libertad y se posponen a v1.1/v2 para proteger la estabilidad y el rendimiento de v1.

### 5.5 Canicas

| Canica | ID | Radio | Masa | Rebote | Fricción | Bonus | Precio | Sensación |
|---|---|---:|---:|---:|---:|---:|---:|---|
| Cristal | `crystal` | 9 | 1,0 | 0,45 | 0,18 | ×1,00 | — | Equilibrada, clara, ligeramente azul. |
| Goma | `rubber` | 9,5 | 0,85 | 0,82 | 0,35 | ×1,00 | 250 | Bota mucho, se frena antes. |
| Acero | `steel` | 8,5 | 2,6 | 0,25 | 0,08 | ×1,05 | 600 | Pesada, rápida, empuja a las demás. |
| Cometa | `comet` | 9 | 1,0 | 0,40 | 0,15 | ×1,15 | 1.500 | Estela cálida, brillo suave. |
| Plasma | `plasma` | 9 | 0,9 | 0,50 | 0,12 | ×1,30 | 2.500 | Estela arcoíris, brillo aditivo. |

- La masa se calcula como `(r/9)² × densidad` y se usa en colisiones canica-canica.
- El rebote de la canica modula el rebote base de la superficie (cristal = valor nominal; goma rebota más; acero menos). En colisiones canica-canica se usa el mínimo de ambos rebotes.
- La fricción es el coeficiente de Coulomb contra superficies; la resistencia a la rodadura es un parámetro aparte del material.
- Las canicas premium no son “mejores” en física, solo distintas y con bonus. El cristal sigue siendo perfectamente válido.
- Visuales: cada canica tiene una ficha pre-renderizada con brillo especular y aro. La de plasma cicla 8 matices pre-generados (sin filtros por frame).

### 5.6 Materiales

| Material | Rebote base (cristal) | Fricción | Rodadura | Sonido | Uso |
|---|---:|---:|---:|---|---|
| `brick` | 0,35 | 0,45 | 0,8 | Golpe seco de plástico | Ladrillos, rampas, placas. |
| `loop` | 0,30 | 0,35 | 0,6 | Zumbido metálico suave | Bucles, medios tubos. |
| `rubber` | 0,92 | 0,60 | 1,2 | Boing elástico | Trampolín, parachoques. |
| `chime` | 0,35 | 0,30 | 0,5 | Nota de xilófono | Láminas musicales. |
| `conveyor` | 0,10 | 0,90 | 1,4 | Motor grave muy tenue | Cinta. |
| `metal` | 0,55 | 0,15 | 0,3 | Ping corto | Molinete, adornos. |
| `field` | — | — | — | Aire/energía | Triggers y campos. |

Los valores son puntos de partida; se afinan en playtest. La legibilidad (“esto bota”, “esto resbala”) importa más que el realismo.

---

## 6. Interfaz, gestos y experiencia táctil

### 6.1 Principios de interfaz

1. **El lienzo manda.** La UI ocupa menos del 15 % de la pantalla y nunca tapa la zona de juego activa.
2. **Un pulgar, un gesto.** Todo lo frecuente está al alcance del pulgar en horizontal.
3. **Sin texto.** Iconos de 2 px de trazo, rellenos planos, gran área táctil (mínimo 56 × 56 px).
4. **Sin hover.** No hay estados que dependan del ratón. En escritorio se emulan con cursor.
5. **Sin modales innecesarios.** Solo tienda, retos, ajustes y pausa son overlays.
6. **Todo se puede deshacer.** La confianza del niño aumenta si sabe que no puede romper nada.

### 6.2 Distribución en pantalla (horizontal)

```
┌──────────────────────────────────────────────────────────────┐
│  ✦ 1.250        [ combo ◯ ]           ⏸  🏆   ⚙   🔊          │  ← barra superior (56 px)
│                                                              │
│                                                              │
│                                                              │
│                       LIENZO / CANVAS                        │
│                                                              │
│                                                              │
│                                                              │
│  [🧱|🔮]                                             ↶  ◎  🧹 │  ← herramientas (izq./der.)
│                                                              │
│  ┌────┬────┬────┬────┬────┬────┬─────────────────────────┐    │
│  │ 🧱 │ 🧱 │ ╱  │ ◡  │ 🎵 │ 🛒 │  (scroll horizontal)     │    │  ← bandeja (96 px + safe area)
│  └────┴────┴────┴────┴────┴────┴─────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

- **Barra superior:** chispas (izquierda), anillo de combo (centro, oculto si no hay cadena), pausa, trofeo, ajustes, sonido (derecha).
- **Conmutador de modo:** píldora grande abajo a la izquierda, con icono de ladrillo y de canica. En modo zurdo se mueve a la derecha.
- **Herramientas contextuales:** deshacer, rehacer (aparece solo si hay algo que rehacer), recentrar, escoba. Se atenúan cuando no aplican.
- **Bandeja:** tarjetas de 72 × 72 px, scroll horizontal con inercia, paginación suave. La bandeja usa `touch-action: pan-x`; cada tarjeta usa `touch-action: none` para que el arrastre vertical hacia el lienzo no se confunda con el scroll. La última tarjeta es la tienda. En modo construir muestra piezas; en modo jugar, canicas.
- **Zona segura:** se respetan `env(safe-area-inset-*)`; la bandeja nunca queda bajo el indicador de inicio.

### 6.3 Distribución en vertical

- La bandeja se mantiene abajo y pasa a dos filas si hay muchas piezas, con scroll.
- La barra superior se compacta: chispas + combo a la izquierda, iconos a la derecha.
- El conmutador de modo se coloca encima de la bandeja, centrado.
- No se bloquea la orientación; el juego se adapta con un reflow de 100 ms.

### 6.4 Mapa de gestos

| Gesto | Modo Construir | Modo Jugar | Notas |
|---|---|---|---|
| Un dedo en vacío, arrastrar | Desplaza la cámara | Desplaza la cámara (si se mueve > 10 px) | Sin inercia; respuesta 1:1. |
| Un dedo en vacío, tocar | Deselecciona | Suelta canica en el punto | El fantasma aparece al tocar y se confirma al soltar. |
| Un dedo sobre pieza, arrastrar | Mueve la pieza | Desplaza la cámara (las piezas no se mueven en Jugar) | En Jugar, tocar una pieza no la selecciona. |
| Un dedo sobre pieza, tocar | Selecciona | — | Contorno + controles. |
| Dos dedos, pellizcar | Zoom centrado en el punto medio | Zoom | Rango 0,3–2,5. |
| Dos dedos, arrastrar | Desplaza la cámara | Desplaza la cámara | Prioridad sobre cualquier gesto de un dedo. |
| Arrastrar desde bandeja | Coloca pieza | Suelta canica al soltar sobre el lienzo | El fantasma sigue al dedo. |
| Arrastrar pieza a la papelera | Borra | — | La papelera aparece solo durante el arrastre. |
| Mantener pulsado en el lienzo | — | Lluvia de canicas (8/s) | Empieza tras 350 ms; se detiene al levantar. |
| Tocar control de rotar y arrastrar | Rota | — | El ángulo se muestra con el propio giro, sin texto. |
| Rueda del ratón / trackpad | Zoom al cursor | Zoom | Solo escritorio. |

En escritorio, el botón izquierdo emula el dedo (clic = toque, arrastrar = gesto), la rueda hace zoom al cursor y `Esc` deselecciona; el clic derecho no se usa para evitar menús contextuales. Un tercer dedo se ignora; el rechazo de palma se delega en iPadOS y no se implementa propio. Apple Pencil funciona como un puntero normal (sin presión).

**Regla de resolución de ambigüedad**

- Un gesto de un dedo se decide al superar **10 px** de desplazamiento o **180 ms**.
- Si en cualquier momento aparece un segundo dedo, se cancela la acción de un dedo:
  - Si era un arrastre desde la bandeja, la pieza vuelve a la bandeja.
  - Si era un arrastre de pieza ya colocada, la pieza se queda donde estaba al iniciar el gesto (no se pierde).
  - Si era un lanzamiento de canica, no se suelta.
- `pointercancel` (llamada entrante, gesto del sistema) cancela limpiamente y no deja estados colgados.

### 6.5 Máquina de estados de interacción

```
IDLE
 ├─ pointerdown en bandeja ─────────► DRAG_FROM_TRAY
 ├─ pointerdown sobre pieza ────────► PRESS_PIECE ─► (move) MOVE_PIECE
 ├─ pointerdown en vacío (Build) ───► PRESS_EMPTY ─► (move) PAN
 ├─ pointerdown en vacío (Play) ────► PRESS_DROP ─► (move) PAN / (up) DROP
 │                                                 └► (hold 350 ms) RAIN
 └─ segundo pointer ────────────────► PINCH_PAN
PINCH_PAN ─ (quedan <2 dedos) ──────► IDLE
RAIN ─ (up / cancel) ───────────────► IDLE
DRAG_FROM_TRAY ─ (up en lienzo) ────► PLACE_PIECE
DRAG_FROM_TRAY ─ (up fuera) ────────► CANCEL
MOVE_PIECE ─ (up) ──────────────────► SELECTED (commit + autosave)
```

- La máquina es explícita y testeable; cada transición registra una acción de deshacer cuando corresponde.
- Los controles DOM capturan sus propios `pointerdown` y no llegan al canvas.

### 6.6 Feedback y “juice” (sin romper el rendimiento)

| Acción | Feedback visual | Feedback sonoro | Duración |
|---|---|---|---|
| Colocar pieza | Escala 0,9 → 1, rebote suave | Clic de plástico | 120 ms |
| Seleccionar | Contorno discontinuo + tirador | Tic muy suave | 80 ms |
| Rotar | Sigue el dedo 1:1; imán a 15° | Tic cada 45° (muy bajo) | Continuo |
| Soltar canica | Escala 0 → 1 + polvo mínimo | Nada (la gravedad suena después) | 80 ms |
| Golpe de xilófono | Destello blanco + anillo + nota | Nota sintetizada | 80 + 240 ms |
| Trampolín | Aplastado 0,85 y rebote | Boing | 200 ms |
| Bucle completado | Anillo de chispas radial | Whoosh ascendente | 300 ms |
| Meta | 12 confetis + campana se balancea | Arpegio de campana | 450 ms |
| Combo sube | El anillo se llena y late | Shimmer corto | 150 ms |
| Compra | La tarjeta vuela a la bandeja | Dos notas | 350 ms |
| Récord | Medalla estampada | Acorde | 500 ms |
| Limpiar | Las canicas se desvanecen | Barrido suave | 250 ms |

- **Sin screen shake** por defecto; solo un desplazamiento de 2 px y 100 ms al batir un récord, desactivable con “reducir movimiento”.
- **Sin partículas caras:** sprites pre-renderizados, pool de 256, `globalAlpha` y `drawImage`. Nada de `shadowBlur` ni filtros.
- **Sin texto flotante:** los puntos se muestran con el icono de chispa + dígitos pre-renderizados.
- **Límite de feedback:** máximo 6 popups simultáneos; los antiguos se funden.

### 6.7 Tienda, retos y ajustes

**Tienda (overlay a pantalla completa)**

- Fondo papel sólido al 96 % (sin `backdrop-filter`, que es caro en iPad antiguo).
- Pestañas de categoría con iconos: construcción, música, energía, canicas.
- Rejilla de 3–4 columnas según ancho; scroll vertical.
- Cada tarjeta: previsualización renderizada (canvas 160 × 120 cacheado), precio con icono, estado (bloqueada/comprada).
- Tarjeta expandida: previsualización animada, precio grande, botón de check.
- Piezas ya compradas muestran un check y no se pueden volver a comprar.
- Cerrar: botón X o toque fuera (con área de exclusión para no cerrar por accidente).

```
┌──────────────────────────────────────────────────────────────┐
│  ✕       [🧱]  [🎵]  [⚡]  [🔮]                    ✦ 1.250    │
│                                                              │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│   │  pieza   │   │  pieza   │   │  pieza   │   │  pieza   │  │
│   │  ✦ 250   │   │  ✦ 300   │   │  ✦ 700   │   │  ✦ 850   │  │
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘  │
│                                                              │
│   ┌──────────┐   ┌──────────┐   ...                           │
│   │  pieza   │   │  pieza   │                               │
│   │  ✓       │   │  ✦ 1.100 │                               │
│   └──────────┘   └──────────┘                               │
└──────────────────────────────────────────────────────────────┘

  Tarjeta expandida:
  ┌────────────────┐
  │  [animación]   │
  │    ✦ 300       │
  │   [   ✓   ]    │
  └────────────────┘
```

**Retos**

- Rejilla de 12 tarjetas con pictograma, número y anillo de progreso.
- Al completar: medalla, acorde, confeti contenido.
- No hay texto; si se necesita una explicación, se anima el pictograma (p. ej., una canica atravesando un bucle tres veces).

**Pausa**

- Congela física y audio, y muestra un botón grande de reanudar, la escoba y el acceso a ajustes.
- Se abre con el icono ⏸ y también de forma automática al ocultar la app o recibir una llamada.
- No hay cuenta atrás ni reanudación con penalización; es una pausa de juguete.

**Ajustes**

- Sonido: 3 estados (silencio / bajo / alto), icono de altavoz.
- Calidad: automática / alta / baja. La automática es la recomendada.
- Zurdo: espeja la barra lateral y el conmutador.
- Reducir movimiento: desactiva shakes, confeti y animaciones de escala.
- Haptics: solo Android; en iOS se muestra desactivado.
- Repetir tutorial.
- Limpiar canicas / borrar mundo (mantener 2 s con anillo de progreso).
- Créditos y versión (única zona con texto pequeño).

### 6.8 Accesibilidad

- Todos los controles tienen `aria-label` en español y foco visible (aunque el juego sea táctil).
- El canvas tiene `role="application"` y una descripción breve.
- Contraste mínimo 3:1 para controles y 4,5:1 para números.
- Las piezas funcionales se distinguen por **forma + color**, no solo por color.
- Targets táctiles de 56 px como mínimo; separación de 8 px.
- Alternativa a pellizcar: botones de zoom +/− en ajustes o doble toque con dos dedos (documentado en la ayuda accesible).
- “Reducir movimiento” respeta `prefers-reduced-motion` al arrancar.
- El sonido nunca es la única señal: cada nota tiene destello; cada compra tiene animación.
- No hay tiempo límite, ni texto pequeño, ni instrucciones que dependan de lectura.

---

## 7. Dirección de arte

### 7.1 Principios

- **Minimalismo cálido:** papel off-white, colores sólidos, sin gradientes decorativos ni texturas.
- **Estética de juguete de mesa premium:** proporciones de ladrillo, tetones redondeados, bordes suaves, sombras planas. No es “infantil”; es “diseño industrial”.
- **Lectura inmediata:** cada pieza se reconoce por silueta y color funcional.
- **Cero ruido:** nada de estrellitas de fondo, nubes, personajes ni ornamentos.
- **Movimiento con propósito:** solo comunica física, selección o recompensa.

### 7.2 Paleta

| Token | Hex | Uso |
|---|---|---|
| `--paper` | `#F2EFE7` | Fondo principal. |
| `--paper-2` | `#E9E4D8` | Overlays, tarjetas. |
| `--ink` | `#23211C` | Texto, contornos, iconos. |
| `--muted` | `#8C8679` | Elementos deshabilitados. |
| `--grid` | `#DCD6C8` | Puntos de rejilla. |
| `--shadow` | `rgba(35,33,28,0.12)` | Sombra plana de piezas. |
| `--blue` | `#3D7EA6` | Ladrillos (color por defecto). |
| `--red` | `#D95D39` | Bucles, imanes, alertas suaves. |
| `--yellow` | `#E9B44C` | Estrellas, metas, detalles. |
| `--green` | `#4F9D69` | Trampolines, éxito. |
| `--purple` | `#7D5BA6` | Cañones, portales. |
| `--pink` | `#D26D8C` | Acentos, canica plasma. |
| `--teal` | `#2E9E97` | Propulsores, portales. |
| `--steel` | `#8B97A3` | Acero, molinetes. |
| `--wood` | `#D9A066` | Xilófonos. |

- Los colores de ladrillo disponibles para el jugador son: azul, rojo, amarillo, verde, morado y rosa. Se aplican con un tono ligeramente desaturado para que el conjunto no grite.
- Las piezas funcionales usan su color de identidad y no se tintan.
- La paleta se prueba con simulación de deuteranopia/protanopia; las formas y los patrones (tetones, flechas, rayas) diferencian.

### 7.3 Piezas

- **Ladrillos:** rectángulo redondeado (radio 6 u), relleno sólido, borde 1,5 u más oscuro, luz superior 1 u al 6 %, sombra inferior 3 u al 12 % (bakeada en el sprite). Los tetones son semicírculos de 24 u de diámetro a lo largo del borde superior, con un aro interior.
- **Rampas:** cápsula con un lado superior más claro para indicar la superficie de rodadura. La textura de tetones no va en la superficie.
- **Trampolín:** marco verde oscuro + superficie verde clara con 3 líneas transversales; se aplasta al impacto.
- **Bucle:** anillo coral con una ranura de entrada y una flecha discreta. El interior es liso.
- **Xilófono:** base de madera clara + láminas de colores cálidos, con un pequeño punto de color en el extremo que indica la nota. La lámina vibra visualmente (flash) al sonar.
- **Propulsor:** carcasa teal con 3 chevrones animados; sin texto.
- **Cañón:** base morada con un resorte visible; se comprime al disparar.
- **Cinta:** banda oscura con flechas claras en movimiento.
- **Meta:** campana dorada con boca ancha; se balancea al recibir una canica.
- **Estrella:** estrella de 5 puntas dorada, con un halo muy tenue.
- **Imán:** disco rojo con dos polos sugeridos por dos medias lunas; anillos concéntricos que laten.
- **Portal:** anillo teal/morado con un vórtice de 3 arcos; el par comparte color.
- **Canicas:** esfera con degradado radial bakeado, aro de 2 u, brillo especular de 5 u y un reflejo secundario. Sin animación de rotación de textura salvo un pequeño punto que gira para mostrar el giro.

### 7.4 Fondo

- Color `--paper` sólido.
- Rejilla de puntos de 2 u de radio cada 40 u, color `--grid` al 55 %; solo visible con zoom ≥ 0,6. A zoom bajo se oculta para evitar aliasing y coste.
- Sin viñeta, sin textura, sin patrón de papel. El minimalismo es el lujo.
- El borde del mundo no existe visualmente: el lienzo continúa.

### 7.5 Sombras y profundidad

- Sombra plana: silueta de la pieza desplazada 3 u hacia abajo, color `--shadow`, sin blur. Se hornea en el sprite.
- En piezas rotadas, la sombra horneada gira con la pieza; al ser un desplazamiento de solo 3 u, se lee como una luz cenital suave y no molesta. Si en las pruebas se nota, se sustituye por una elipse de contacto plana solo para esas piezas.
- Las canicas tienen una elipse de contacto de 14 × 6 u al 10 % cuando están cerca de una superficie (opcional, coste mínimo).
- No hay sombras dinámicas ni luces. La profundidad se sugiere con el borde inferior más oscuro.
- Los overlays usan una sombra CSS suave solo en los paneles grandes (coste de composición bajo, no de canvas).

### 7.6 Tipografía e iconos

- **Tipografía:** pila del sistema (`ui-rounded`, `-apple-system`, `system-ui`). Sin fuentes descargadas. Números tabulares para contadores.
- **Texto permitido:** cifras, precios, ajustes y créditos. Nada más.
- **Iconos:** set propio de ~30 SVG inline, trazo de 2 px, extremos redondeados, 24 × 24. Se definen una vez como `<symbol>` y se reutilizan.
- **Logo:** una canica dentro de un ladrillo, o una canica con un tetón; sin wordmark en el juego. El nombre aparece solo en el manifest, la pestaña y los créditos.

### 7.7 Animación

- Duraciones: 80–150 ms para UI; 200–450 ms para celebraciones.
- Curvas: `cubic-bezier(.2,.8,.2,1)` para entrada; `ease-out` para salida.
- Solo `transform` y `opacity` en CSS (GPU).
- Nada de animaciones ambientales continuas en el canvas: ahorran batería y mantienen la atención en la física.
- El modo inactivo (sin canicas moviéndose) baja a renderizado bajo demanda o 15 fps; cualquier toque lo despierta.

---

## 8. Dirección de audio

### 8.1 Principios

- **Todo sintetizado.** Cero archivos, cero descargas, cero problemas de licencias.
- **Musical por diseño.** Escala pentatónica + timbres suaves = es imposible sonar mal.
- **El sonido informa.** Material, velocidad y tamaño se oyen. Una canica de acero suena distinta de una de goma.
- **Nunca satura.** Compresor de bus, límite de voces, ganancias conservadoras.
- **Sin música de fondo.** El paisaje sonoro lo construye el jugador.
- **Silencio respetado.** 3 niveles; el silencio es un estado de primera clase.

### 8.2 Cadena de audio

```
Voces (máx. 16) ─┐
Cama de rodadura ─┼─► Bus SFX ─► Compresor ─► Master ─► destination
UI ──────────────┘
```

- **Compresor:** threshold −18 dB, knee 12, ratio 4:1, attack 3 ms, release 150 ms.
- **Master:** ganancia 0,8; limitador suave para evitar clipping.
- **Voces:** máximo 16 simultáneas; si se supera, se roba la más antigua/quieta con un fade de 20 ms.
- **Rodadura:** una sola cama de ruido rosa filtrado (paso banda 300–1.200 Hz), con ganancia ligada a la energía cinética de las canicas en contacto y paneo al centroide. Evita 200 filtros individuales.
- **Paneo:** `StereoPannerNode` según la x en pantalla, con atenuación suave por distancia al centro de la cámara.
- **Latencia:** los sonidos de impacto se programan en el instante del evento físico, no en el siguiente frame de render.

### 8.3 Xilófono: síntesis

Cada nota se genera con 4 parciales de barra libre-libre y un transitorio de mazo:

| Parcial | Ratio | Amplitud | Decaimiento |
|---|---:|---:|---:|
| Fundamental | 1,00 | 1,00 | 0,9–1,6 s según nota |
| 2.º | 2,76 | 0,35 | 0,6 s |
| 3.º | 5,40 | 0,18 | 0,35 s |
| 4.º | 8,93 | 0,09 | 0,2 s |

- Osciladores `sine` (o `triangle` para las notas graves) con envolvente exponencial.
- Ataque de 4 ms; sin clic.
- Transitorio: 8 ms de ruido filtrado paso alto, ganancia 0,08, para el “mazo”.
- La velocidad del impacto mapea a ganancia (`v^0.8`) y a un filtro paso bajo (más velocidad = más brillo), no a la afinación.
- Pequeño detune aleatorio de ±3 cents para que las repeticiones no suenen idénticas.
- Las notas graves duran más; las agudas, menos. El resultado debe recordar a un xilófono de madera real, no a un sintetizador de videojuego.

### 8.4 Efectos de sonido

| Evento | Diseño | Duración | Ganancia |
|---|---|---:|---:|
| Impacto en ladrillo | Seno 180 Hz + ruido corto | 60 ms | 0,12 |
| Impacto en metal | Seno 1.800 Hz + ruido | 90 ms | 0,10 |
| Impacto en cristal | Ping 2.400 Hz | 70 ms | 0,08 |
| Trampolín | Seno con pitch 180 → 320 Hz | 220 ms | 0,16 |
| Propulsor | Ruido paso banda 400 → 2.000 Hz | 300 ms | 0,10 |
| Cañón | Ruido + seno 90 Hz | 180 ms | 0,18 |
| Bucle completado | Whoosh + quinta ascendente | 350 ms | 0,12 |
| Meta | Arpegio Do-Mi-Sol-Do (campana) | 450 ms | 0,15 |
| Estrella | Campanilla de dos parciales | 180 ms | 0,10 |
| Compra | Dos notas (Do5–Sol5) | 300 ms | 0,12 |
| Clic de UI | Ruido filtrado 1 kHz | 20 ms | 0,05 |
| Tope/límite | Seno grave 110 Hz | 120 ms | 0,08 |
| Error suave | Dos notas descendentes muy bajas | 180 ms | 0,06 |

- Ningún sonido supera 0,2 de ganancia individual.
- Los sonidos de UI se limitan a 12 por segundo para evitar metralleo.
- El sonido de compra y el de meta son los únicos “celebradores”; se reservan para momentos importantes.

### 8.5 Mezcla y rendimiento

- Presupuesto de audio: < 1 ms de CPU por frame en iPad 6.
- Nodos creados por nota; se desconectan al terminar. Sin bucles de osciladores permanentes salvo la cama de rodadura.
- La cama de rodadura se crea una vez y se modula con `setTargetAtTime`.
- Si el contexto está en estado `suspended`, no se programa nada y se reanuda en el siguiente gesto.
- Al ocultar la pestaña: `suspend()`; al volver: `resume()` y reinicio de la cama.

### 8.6 iOS / Web Audio

- El contexto se crea y se reanuda en el **primer `pointerdown`** (no en `load`), para cumplir la política de autoplay de Safari.
- Se reproduce un buffer silencioso de 1 muestra para desbloquear el contexto en iOS antiguos.
- `visibilitychange` y `pagehide`: suspender; `pageshow`/`focus`: reanudar.
- Se maneja `statechange` para recuperar el contexto tras una interrupción (llamada, Siri, bloqueo).
- El interruptor de silencio del iPad puede silenciar Web Audio según la sesión; se prueba en dispositivo y se documenta. No se fuerza la reproducción si el usuario ha silenciado el dispositivo.
- Los ajustes de sonido se guardan y se aplican antes de cualquier nota.

---

## 9. Arquitectura técnica

### 9.1 Stack

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript estricto | Seguridad en física, datos y serialización. |
| Build | Vite | Rápido, salida estática, sin runtime. |
| Render | Canvas 2D | Escena 2D, pocos draw calls, Safari predecible. |
| UI | DOM + CSS | HUD nítido, accesible, sin coste de canvas. |
| Física | Motor propio | Control total, tamaño pequeño, comportamiento a medida. |
| Audio | Web Audio API | Síntesis, cero assets, latencia baja. |
| Persistencia | `localStorage` | Sencillo, suficiente para ~100 KB por mundo. |
| Tests | Vitest | Física pura testeable sin DOM. |
| E2E | Playwright (opcional) | Gestos y flujo de compra en escritorio. |
| Deploy | GitHub Pages + Actions | Estático, gratis, versionado. |
| Dependencias de runtime | **0** | Bundle mínimo, arranque rápido, menos fallos. |

### 9.2 Estructura del repositorio

```
marblelous/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ public/
│  ├─ manifest.webmanifest
│  ├─ icon-192.png
│  ├─ icon-512.png
│  └─ apple-touch-icon.png
├─ src/
│  ├─ main.ts                 # bootstrap
│  ├─ app.ts                  # máquina de estados de la app
│  ├─ core/
│  │  ├─ loop.ts              # rAF + paso fijo
│  │  ├─ math.ts              # vec2, clamp, lerp, ángulos
│  │  ├─ rng.ts               # aleatorio sembrado (partículas)
│  │  ├─ events.ts            # event bus tipado
│  │  ├─ pool.ts              # pools sin allocaciones
│  │  └─ storage.ts           # localStorage + migraciones
│  ├─ physics/
│  │  ├─ world.ts             # mundo, colisionadores, chunks
│  │  ├─ broadphase.ts        # hash espacial
│  │  ├─ collide.ts           # círculo-cápsula, círculo-círculo
│  │  ├─ marble.ts            # estado y paso de canica
│  │  ├─ materials.ts         # tabla de materiales
│  │  └─ triggers.ts          # zonas, campos, metas
│  ├─ game/
│  │  ├─ pieces.ts            # registro data-driven
│  │  ├─ pieceDefs.ts         # definiciones y geometría
│  │  ├─ worldModel.ts        # piezas, límites, bbox, chunks
│  │  ├─ economy.ts           # chispas, precios, compras
│  │  ├─ scoring.ts           # eventos, combo, récords
│  │  ├─ challenges.ts        # 12 retos
│  │  ├─ tutorial.ts          # pasos sin texto
│  │  └─ save.ts              # esquema y serialización
│  ├─ render/
│  │  ├─ renderer.ts          # pipeline de frame
│  │  ├─ camera.ts            # zoom/pan, transformaciones
│  │  ├─ sprites.ts           # generación y caché de sprites
│  │  ├─ particles.ts         # pool de partículas
│  │  ├─ background.ts        # papel + rejilla
│  │  └─ popups.ts            # dígitos y chispas flotantes
│  ├─ input/
│  │  ├─ pointer.ts           # Pointer Events unificados
│  │  ├─ gestures.ts          # tap/pan/pinch/rotación
│  │  └─ selection.ts         # pieza seleccionada y handles
│  ├─ audio/
│  │  ├─ engine.ts            # contexto, buses, compresor
│  │  ├─ synth.ts             # voces, xilófono, ruido
│  │  └─ sfx.ts               # mapa de eventos a sonidos
│  ├─ ui/
│  │  ├─ hud.ts               # contadores, combo, botones
│  │  ├─ tray.ts              # bandeja y scroll
│  │  ├─ shop.ts              # overlay de tienda
│  │  ├─ challenges.ts        # overlay de retos
│  │  ├─ settings.ts          # ajustes
│  │  ├─ icons.ts             # SVG symbols
│  │  └─ toast.ts             # avisos icónicos
│  ├─ data/
│  │  ├─ shop.ts              # precios y orden
│  │  ├─ challenges.ts        # definiciones de retos
│  │  └─ strings.es.ts        # aria-labels y créditos
│  └─ styles/
│     ├─ tokens.css           # variables de diseño
│     ├─ base.css             # reset, safe areas, canvas
│     └─ ui.css               # HUD, overlays, bandeja
├─ tests/
│  ├─ physics.test.ts
│  ├─ serialization.test.ts
│  ├─ economy.test.ts
│  └─ challenges.test.ts
└─ .github/workflows/deploy.yml
```

### 9.3 Principios de arquitectura

- **Núcleo puro:** `physics/`, `game/`, `core/math.ts` no tocan DOM ni Canvas. Se pueden ejecutar en Node para tests.
- **Datos > código:** las piezas se describen en un registro; añadir una pieza no debería requerir tocar el motor.
- **Un solo estado:** la app tiene un estado serializable (mundo + progreso + ajustes); el render y la UI lo leen.
- **Eventos tipados:** la física emite `chime`, `bounce`, `loop`, `goal`, `star`, `boost`, `record`; puntuación, audio, partículas y retos escuchan. Bajo acoplamiento.
- **Sin allocaciones en el bucle:** vectores reutilizados, pools de partículas y de popups, arrays preasignados.
- **Todo reversible:** las ediciones generan comandos con `apply/revert` para deshacer.
- **Estados explícitos:** `BOOT → SANDBOX (BUILD / PLAY) ↔ OVERLAY (SHOP / CHALLENGES / SETTINGS / PAUSE)`. Los overlays pausan la simulación; al cerrarlos se restaura el estado exacto.

### 9.4 Bucle principal

```ts
const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1;      // 100 ms; evita catch-up tras volver de background
const MAX_STEPS = 12;       // 120 Hz × 100 ms

function frame(now: number) {
  const raw = Math.min((now - last) / 1000, MAX_FRAME);
  last = now;

  accumulator += raw;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    physics.step(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0; // descartar exceso

  const alpha = accumulator / FIXED_DT;
  renderer.render(alpha);   // interpola posiciones de canicas
  audio.update(raw);
  hud.update(raw);
  requestAnimationFrame(frame);
}
```

- **Interpolación:** cada canica guarda `prevX/prevY` y `x/y`; el render usa `lerp(prev, curr, alpha)`. A 30 fps de render, las canicas siguen viéndose suaves.
- **Pausa:** si el documento está oculto o hay un overlay modal, no se acumula tiempo; al volver, `accumulator = 0`.
- **Modo inactivo:** si no hay canicas despiertas, partículas ni animaciones de cámara durante 1 s, se renderiza bajo demanda (solo al cambiar algo) o a 15 fps. Cualquier entrada vuelve a 60 fps.

### 9.5 Modelo de datos

```ts
type Vec2 = { x: number; y: number };

interface PieceInstance {
  id: number;
  defId: string;          // "brick2", "loop", ...
  x: number; y: number;   // centro en u
  rot: number;            // radianes
  len?: number;           // rampas (80–240)
  color?: number;         // índice de paleta (0–5)
  variant?: number;
}

interface ColliderSpec {
  ax: number; ay: number; // extremos en espacio local
  bx: number; by: number;
  r: number;              // radio de cápsula
  material: MaterialId;
  oneWay?: boolean;
}

interface TriggerSpec {
  kind: 'goal' | 'star' | 'boost' | 'cannon' | 'magnet' | 'portal';
  x: number; y: number;
  w?: number; h?: number;
  radius?: number;
  rot?: number;
  power?: number;
  pairId?: number;
  cooldown?: number;
}

interface MarbleBody {
  id: number;
  typeId: string;
  x: number; y: number;
  px: number; py: number;   // posición previa (interpolación)
  vx: number; vy: number;
  r: number;
  mass: number;
  invMass: number;
  restitution: number;
  friction: number;
  rolling: number;
  spin: number;
  awake: boolean;
  sleepTimer: number;
  contact: boolean;
  airTime: number;
  lastContactAt: number;
  trail?: Float32Array;     // 12 puntos × 2, solo premium
  dropId: number;
  alive: boolean;
}
```

### 9.6 Registro de piezas

```ts
interface PieceDef {
  id: string;
  category: 'build' | 'music' | 'energy' | 'goal';
  price: number;              // 0 = incluida
  footprint: { w: number; h: number };
  colliders(p: PieceInstance): ColliderSpec[];
  triggers?(p: PieceInstance): TriggerSpec[];
  sprite: SpriteKey;          // clave de caché
  tintable: boolean;
  maxPerWorld?: number;
}
```

- `colliders()` devuelve coordenadas locales; el mundo las transforma una vez al colocar/editar y las guarda en el chunk correspondiente.
- Para el bucle, `colliders()` genera 64 cápsulas a lo largo de un arco de 320°; para la rampa curva, 24; para el medio tubo, 40.
- El dibujo no reutiliza los colisionadores: cada pieza tiene un sprite pre-renderizado, mucho más barato que dibujar 64 cápsulas por frame.

### 9.7 Comunicación entre sistemas

```
Input ──► App state ──► WorldModel ──► PhysicsWorld
                              │              │
                              │              ├─► events: chime/bounce/loop/goal/...
                              │              │
                              ▼              ▼
                           Renderer ◄── HUD / Audio / Scoring / Particles
```

- `PhysicsWorld` emite eventos con posición, material, velocidad e id de canica.
- `Scoring` decide puntos y combo; `Audio` reproduce; `Particles` celebra; `Challenges` actualiza progreso.
- Ningún sistema de presentación escribe en el mundo físico.

### 9.8 Despliegue en GitHub Pages

- `vite.config.ts` con `base: './'` para que funcione en `usuario.github.io/marblelous/` y en dominio propio.
- Workflow de GitHub Actions: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, subir `dist` como artefacto de Pages.
- Sin routing del lado del servidor: una sola `index.html`.
- Assets con hash en el nombre (Vite) para cache busting.
- `manifest.webmanifest` con `start_url: "./"`, `scope: "./"`, `display: "standalone"`, `orientation: "any"`, colores de tema.
- Service worker mínimo para offline (ver 9.9).
- Comprobación de tamaño de bundle en CI (< 150 KB gzip JS + CSS).

### 9.9 PWA y offline

- El service worker cachea el app shell y los assets con estrategia **stale-while-revalidate**.
- En la primera visita se cachea todo lo necesario; a partir de ahí, el juego abre sin red.
- Actualización: nuevo service worker en espera; se muestra un icono de refresco discreto. Se activa al cerrar y abrir, sin interrumpir una partida.
- No se cachean datos de usuario (no hay).
- `navigator.storage.persist()` opcional para reducir desalojos; no se insiste.

---

## 10. Motor de física

### 10.1 Unidades y constantes

| Constante | Valor | Nota |
|---|---:|---|
| Unidad de mundo | 1 u ≈ 1 px CSS a zoom 1 | Rejilla fina 20 u; ladrillo 80 × 40. |
| Gravedad | 1.800 u/s² | Hacia +y (pantalla). |
| Paso fijo | 1/120 s | 2 pasos por frame a 60 fps. |
| Paso máximo de frame | 100 ms | Evita saltos tras background. |
| Velocidad máxima | 2.800 u/s | Tope de seguridad. |
| Radio de canica | 8,5–9,5 u | Por tipo. |
| Umbral de sueño | 22 u/s | Durante 0,6 s con contacto. |
| Slop de penetración | 0,5 u | Evita jitter. |
| Corrección posicional | 90 % | Por paso. |
| Umbral de rebote | 80 u/s | Por debajo, rebote 0 (reposo). |
| Iteraciones de contacto | 2 | Estático + dinámico. |
| Substeps máximos | 8 | Adaptativos por velocidad. |

### 10.2 Integración

Se usa **Euler semi-implícito** con paso fijo. Es estable, barato y suficientemente preciso para un juego:

```
v += g * dt
v *= exp(-drag * dt)          // drag ~0.02, casi inapreciable
|v| = min(|v|, vmax)
p += v * dt
resolver colisiones (estáticas y dinámicas)
aplicar triggers
actualizar estado de sueño
```

- La rotación visual de la canica se deriva de la velocidad tangencial: `spin += (v · t) / r * dt`. No se simula un cuerpo rígido completo; para una esfera es indistinguible y cuesta una fracción.
- No hay fricción viscosa fuerte: la resistencia a la rodadura se aplica solo en contacto.

### 10.3 Colisionadores

**Cápsula (segmento + radio)** para todo lo sólido:

- Ladrillo: 4 cápsulas con radio 4 u (esquinas redondeadas).
- Rampa: 1 cápsula de radio 6 u.
- Rampa curva: 24 cápsulas de radio 6 u.
- Bucle: 64 cápsulas de radio 5 u.
- Medio tubo: 40 cápsulas.
- Embudo: 30 cápsulas.
- Lámina de xilófono: 1 cápsula de radio 7 u.
- Trampolín: 1 cápsula de radio 5 u.

Ventajas: la colisión círculo-cápsula es analítica, barata y estable; no hay polígonos cóncavos ni normales ambiguas. Los colisionadores se generan en espacio de mundo al colocar o editar una pieza y se almacenan en el chunk; durante la simulación no hay transformaciones.

**Rectángulos**: se modelan con 4 cápsulas; las esquinas quedan redondeadas, lo que además ayuda a que la canica no se atasque.

**Triggers**: AABB o círculo, sin respuesta física. Se evalúan con la posición de la canica y un cooldown por canica.

### 10.4 Broadphase

**Estático**

- Chunks de 512 × 512 u.
- Cada chunk guarda un array de colisionadores y un índice de celdas de 64 u.
- Al consultar, se calcula el AABB barrido de la canica, se obtienen las celdas y se recogen los ids únicos.
- Los colisionadores se reconstruyen solo cuando se edita una pieza de ese chunk.

**Dinámico**

- Hash espacial de canicas con celdas de 32 u, reconstruido cada paso (200 canicas → barato).
- Solo se emparejan canicas despiertas; una canica dormida se despierta si otra la golpea.

**Caché de candidatos**

- Por canica y por frame, se guarda la lista de colisionadores cercanos (AABB + margen). Se reutiliza en los substeps; se recalcula si la canica sale del margen o cambia de chunk.
- Típicamente < 20 candidatos por canica, incluso en escenarios densos.

### 10.5 Detección y respuesta

**Círculo vs cápsula**

```
P = closestPointOnSegment(C, A, B)
d = C - P
dist = |d|
if (dist < r + R):
    n = dist > 1e-6 ? d / dist : normalOfSegment(A, B)
    penetration = (r + R) - dist
    C += n * penetration * 0.9
    vn = dot(v, n)
    if (vn < 0):
        // el rebote de la superficie se modula por el de la canica
        e = (vn < -80) ? clamp(e_surface * (e_marble / 0.45), 0, 0.95) : 0
        v -= n * (1 + e) * vn
        // fricción de Coulomb solo en impactos reales
        if (vn < -80):
            vt = v - n * dot(v, n)
            maxFriction = mu * (1 + e) * abs(vn)
            if (|vt| > maxFriction):
                v -= normalize(vt) * maxFriction
            else:
                v -= vt
```

- La corrección posicional se aplica antes de la respuesta de velocidad.
- El rebote base de la superficie se modula por el de la canica: el cristal (0,45) usa el valor nominal, la goma rebota más y el acero menos. El resultado se limita a 0,95 para no inyectar energía.
- La fricción de Coulomb solo se aplica en impactos con velocidad normal alta. En contacto rodante se usa la resistencia a la rodadura, mucho más suave: así una canica no se frena de golpe al entrar en una rampa.
- Se resuelven dos iteraciones para esquinas y contactos múltiples; con cápsulas es suficiente.
- Si la penetración es menor que el slop, no se corrige (evita temblor en reposo).

**Círculo vs círculo (canicas)**

```
n = normalize(C2 - C1)
overlap = r1 + r2 - dist
C1 -= n * overlap * (invM1 / (invM1 + invM2))
C2 += n * overlap * (invM2 / (invM1 + invM2))

rv = v2 - v1
vn = dot(rv, n)
if (vn < 0):
    e = min(e1, e2)
    j = -(1 + e) * vn / (invM1 + invM2)
    v1 -= n * j * invM1
    v2 += n * j * invM2
    // fricción tangencial ligera (0,05)
```

- La masa importa: el acero empuja al cristal; la goma sale despedida.
- No se simulan rotaciones por fricción entre canicas; solo el giro visual.

### 10.6 Substeps y túnel

A 2.800 u/s y 1/120 s, una canica recorre 23,3 u por paso. Su radio es ~9 u y las cápsulas tienen radio ≥ 4 u, así que un solo paso podría atravesar una superficie fina. Solución:

```
maxStep = r * 0.8
steps = clamp(ceil(|v| * dt / maxStep), 1, 8)
h = dt / steps
for i in steps:
    p += v * h
    resolver estáticas
    resolver dinámicas
    triggers
```

- A velocidad máxima: `steps = ceil(23,3 / 7,2) = 4`; el desplazamiento por substep es 5,8 u, menor que la suma de radios (13 u). No hay túnel.
- Los substeps solo se pagan en canicas rápidas; una canica lenta hace 1.
- No se usa swept-cast: con el tope de velocidad y los radios actuales, los substeps son suficientes y mucho más simples.

### 10.7 Casos especiales

**Bucles**

- El anillo es un arco de 320° con radio de centro 80 u y cápsulas de radio 5 u.
- La canica entra por la abertura inferior; al estar dentro, el anillo la empuja hacia el centro, lo que produce el efecto de loop-the-loop.
- Para completar el bucle, la canica necesita velocidad suficiente en la parte superior. La detección de “bucle completado” acumula el ángulo recorrido alrededor del centro mientras está dentro del anillo; si supera 300° y sale, otorga puntos.
- Si la canica se cae, no pasa nada: el jugador aprende y añade un propulsor.

**Rampas y reposo**

- La resistencia a la rodadura se aplica solo cuando hay contacto: `v_t *= exp(-rolling * dt)`.
- Si la velocidad total es < 22 u/s durante 0,6 s con contacto, la canica duerme.
- Al dormir, se deja de simular; se dibuja en su última posición. Se despierta si otra canica la golpea, si se borra una pieza cercana o si se reinicia el mundo.

**Trampolín**

- Rebote 0,92, con tope de velocidad de salida (2.200 u/s) para que no dispare canicas fuera del mundo.
- El aplastado es puramente visual.
- El impulso se aplica solo si la velocidad normal de entrada supera 60 u/s; así una canica rodando despacio no “explota”.

**Propulsor**

- Trigger AABB orientado. Mientras la canica está dentro, se aplica aceleración en la dirección del propulsor: `v += dir * 3.000 * dt`, con tope de 2.600 u/s.
- No modifica la componente perpendicular.
- Cooldown de puntos de 500 ms; el efecto físico es continuo.

**Cañón**

- Trigger de contacto. Aplica un impulso instantáneo de 1.800 u/s en la normal de la base, con cooldown de 300 ms por canica.
- Tope de velocidad global.

**Cinta**

- En contacto, la velocidad tangencial se aproxima a 220 u/s en la dirección de la cinta: `v_t += clamp(target - v_t, -a*dt, a*dt)`.
- No da puntos.

**Imán**

- Campo radial: `a = 900 * (1 - d/R)` hacia el centro, si `d < R`.
- Tope de velocidad.
- Puede crear órbitas; no da puntos por sí solo.

**Portal**

- Al entrar, se teletransporta a la posición del par, rota la velocidad según la orientación relativa y aplica un cooldown de 350 ms.
- Se desactiva el trigger de salida durante el cooldown para evitar bucles infinitos.
- Conserva la velocidad; no hay pérdida.

**Metas y estrellas**

- Trigger; al entrar, evento, puntos, animación y eliminación (meta) o cooldown y reaparición (estrella).
- La meta elimina la canica al instante lógico, pero su desaparición visual dura 200 ms.

### 10.8 Sueño, limpieza y límites

- **Dormir:** 0,6 s por debajo de 22 u/s con contacto.
- **Despertar:** colisión con otra canica, edición cercana o reanudación del mundo.
- **Canicas dormidas:** máximo 80; se eliminan las más antiguas con fade.
- **Canicas activas:** máximo 200; se elimina la más antigua.
- **Fuera del mundo:** si una canica está a más de 4.000 u del bbox del contenido y sin contacto durante 6 s, se elimina con fade.
- **Tras limpiar:** todas las canicas se desvanecen y se resetea el estado de la tirada.

### 10.9 Estabilidad y determinismo

- Paso fijo y gravedad constante → comportamiento reproducible para las mismas condiciones (sin red).
- Los eventos de puntuación usan cooldowns basados en tiempo de simulación, no en `Date.now()`.
- Las partículas usan un RNG sembrado; no afectan a la física.
- No hay aleatoriedad en la física de canicas (salvo el detune de audio, que es estético).
- Se prueban casos límite: esquinas, contactos múltiples, canica entre dos paredes, bucle a baja velocidad, reposo en rampa inclinada.

---

## 11. Renderizado y optimización

### 11.1 Por qué Canvas 2D y no WebGL

- La escena es 2D, con sprites y transformaciones afines; no hay luces, sombras dinámicas ni miles de partículas.
- Canvas 2D en Safari está acelerado por GPU para `drawImage` y transformaciones; es más que suficiente.
- WebGL añadiría complejidad de shaders, context loss, memoria de texturas y un motor de sprites propio, sin ganancia clara para este juego.
- Si en el futuro se necesitan > 5.000 sprites o efectos de fluido, se reevalúa. Para v1, Canvas 2D gana en simplicidad, batería y previsibilidad.

### 11.2 Pipeline de frame

```
1. Ajustar tamaño del canvas si cambió (DPR limitado).
2. Limpiar con --paper (alpha: false en el contexto principal).
3. Contexto de cámara: setTransform(zoom, 0, 0, zoom, tx, ty).
4. Fondo: rejilla (si zoom ≥ 0.6) mediante pattern.
5. Piezas visibles: frustum culling por chunks; drawImage del sprite con rotación.
6. Canicas: drawImage interpolado; estela si procede.
7. Partículas y popups: drawImage con alpha.
8. Fantasma de pieza/canica y selección (si aplica).
9. HUD DOM: actualización solo si cambian valores.
```

- El contexto principal se crea con `{ alpha: false }`, lo que mejora el compositing.
- No se usan `shadowBlur`, `filter`, `clip()` por pieza ni gradientes por frame.
- Las rotaciones usan `save/translate/rotate/drawImage/restore`; aun así, se agrupan por tipo cuando es posible para reducir cambios de estado.

### 11.3 Sprites pre-renderizados

- Cada tipo de pieza y color se renderiza una vez a un canvas fuera de pantalla, a 3 niveles de detalle:
  - **LOD 0:** zoom < 0,55 (sin tetones, trazo simplificado).
  - **LOD 1:** 0,55–1,25 (detalle normal).
  - **LOD 2:** > 1,25 (detalle alto, tetones y brillos).
- El sprite incluye relleno, borde, tetones y sombra plana; dibujarlo es un solo `drawImage`.
- Caché LRU de ~80 sprites; los no usados se descartan.
- Los sprites se generan de forma perezosa al cargar el mundo o al cambiar de color; nunca durante un pico de física.
- Las rampas tienen un sprite por longitud (7 valores entre 80 y 240 u) y por color; se generan al usar esa longitud por primera vez.
- Las canicas tienen sprites con degradado radial bakeado (64 × 64 px) y una versión con halo para las premium.
- Los dígitos y el icono de chispa son sprites pequeños; los popups se componen con `drawImage`, sin `fillText`.

### 11.4 Culling y LOD

- El mundo se divide en chunks de 512 u solo para indexar piezas y colisionadores.
- Cada frame se calcula el rango de chunks visibles según la cámara y se iteran solo esos.
- A zoom < 0,4 se usa LOD 0 y se omiten sombras y tetones; el escenario se lee como manchas de color, suficiente para navegar.
- Las piezas fuera de pantalla no se dibujan ni se actualizan (son estáticas).
- Las canicas fuera de pantalla siguen simulando si están cerca del contenido; si están muy lejos, se eliminan.

### 11.5 Partículas y popups

- Pool fijo de 256 partículas; arrays paralelos (`x, y, vx, vy, life, sprite, alpha`).
- Máximo 6 popups de puntos simultáneos; cada uno es una secuencia de sprites de dígitos.
- Confeti de meta: 12–20 partículas, no 200.
- Estelas premium: 12 puntos por canica, máximo 30 canicas con estela a la vez.
- Sin `Path2D` por partícula; solo `drawImage`.

### 11.6 Calidad adaptativa

Un monitor de frame time con media móvil decide la calidad:

| Nivel | DPR | Partículas | Estelas | Sombras | Rejilla | Objetivo |
|---|---:|---:|---|---|---|---|
| Alta | min(devicePixelRatio, 2) | 256 | Sí | Sí | Sí | 60 fps |
| Media | 1,5 | 120 | Solo premium | Sí | Sí | 60 fps |
| Baja | 1,25 | 48 | No | No | Solo zoom alto | 30–60 fps |

- Si la media de frame time supera 22 ms durante 2 s → bajar un nivel.
- Si supera 30 ms durante 2 s → bajar a Baja y limitar el render a 30 fps (la física sigue a 120 Hz).
- Si se mantiene por debajo de 14 ms durante 5 s → subir un nivel, con histéresis para no oscilar.
- La calidad automática es el ajuste por defecto; el jugador puede forzarla en ajustes.
- Nunca se degrada la física ni la respuesta al tacto; solo la presentación.

### 11.7 Presupuesto de frame (iPad 6, calidad Media)

| Tarea | Presupuesto |
|---|---:|
| Física (200 canicas, 1.500 colisionadores visibles) | 3,5 ms |
| Render (fondo + 800 sprites + 200 canicas + partículas) | 8,0 ms |
| Input + UI DOM | 1,0 ms |
| Audio | 0,8 ms |
| Margen | 3,4 ms |
| **Total** | **16,7 ms** |

- La física se mide con el peor caso: 200 canicas despiertas y un escenario denso.
- Si el render se pasa, se recorta primero la rejilla, luego las sombras, luego el DPR.
- El objetivo real es 60 fps estables; 30 fps es la red de seguridad, no el objetivo.

### 11.8 Memoria

- Canvas principal: ~2048 × 1536 × 4 B ≈ 12 MB a DPR 2 (iPad 6). A 1,5, ~7 MB.
- Sprites: < 20 MB con caché LRU.
- Estado JS: < 10 MB con 2.000 piezas y 200 canicas.
- Audio: < 5 MB.
- Total objetivo: < 80 MB; techo: 120 MB.
- Se evitan arrays temporales por frame; se reutilizan vectores y objetos.

### 11.9 Modo inactivo y batería

- Si no hay canicas despiertas, partículas ni animaciones de cámara durante 1 s, se deja de renderizar a 60 fps.
- Se sigue renderizando bajo demanda cuando cambia la cámara, se selecciona algo o se edita.
- La cama de rodadura baja a 0 cuando no hay contacto.
- Al ocultar la pestaña, se suspende el rAF y el audio.
- Esto reduce el consumo en las largas sesiones de construcción, que son la mitad del juego.

### 11.10 Qué se evita explícitamente

- `backdrop-filter` (caro en iPad antiguo).
- `shadowBlur` en canvas.
- Filtros CSS sobre el canvas.
- Gradientes creados por frame.
- `fillText` por frame.
- `setInterval` para animación.
- DOM por partícula.
- Recrear el canvas al rotar (se redimensiona).
- Cambiar `canvas.width/height` en cada frame (solo al redimensionar).
- Guardar en `localStorage` en cada frame (debounce).
- Frameworks de UI (React/Vue) para un HUD de 10 elementos.

### 11.11 Cámara y coordenadas

La cámara no rota: solo traslada y escala. Esto mantiene la física alineada con la pantalla y simplifica todos los gestos.

```
// mundo → pantalla (CSS px)
sx = (wx - cam.x) * zoom + viewport.w / 2
sy = (wy - cam.y) * zoom + viewport.h / 2

// pantalla → mundo
wx = (sx - viewport.w / 2) / zoom + cam.x
wy = (sy - viewport.h / 2) / zoom + cam.y

// zoom manteniendo fijo el punto de pantalla P
cam.x += (P.x - viewport.w / 2) / zoomViejo
       - (P.x - viewport.w / 2) / zoomNuevo
cam.y += (P.y - viewport.h / 2) / zoomViejo
       - (P.y - viewport.h / 2) / zoomNuevo
zoom = zoomNuevo
```

- `cam` es el punto del mundo que queda en el centro de la pantalla; el zoom se limita a **0,3–2,5**.
- El pellizco aplica el zoom de forma inmediata, centrado en el punto medio de los dedos; los botones +/− lo animan en 120 ms.
- Al redimensionar u orientar, se conserva el centro de la cámara y se recalcula la matriz; no se reencuadra el contenido.
- **Recentrar:** calcula el bbox de todas las piezas, añade un margen de 80 px y ajusta el zoom para que quepa, con un máximo de 1,2 y un mínimo de 0,3. Si no hay piezas, vuelve a (0,0) a zoom 1.
- El canvas se dimensiona como `cssW * dpr × cssH * dpr` y la matriz de cámara se multiplica por `dpr`; así el dibujo es nítido sin cambiar las coordenadas de juego.
- No hay inercia de paneo: en un juguete de construcción, la respuesta 1:1 se siente más precisa y evita marear.

---

## 12. Persistencia y datos

### 12.1 Esquema de guardado

```ts
interface SaveData {
  v: 1;
  updatedAt: number;
  currency: number;
  lifetime: number;
  owned: string[];              // ids de piezas y canicas
  activeWorld: number;          // 0–2
  worlds: WorldData[];
  settings: {
    sound: 0 | 1 | 2;
    quality: 'auto' | 'high' | 'low';
    leftHanded: boolean;
    reduceMotion: boolean;
    haptics: boolean;
    tutorialSeen: boolean;
  };
  challenges: Record<string, number>; // progreso, global
  tutorialStep: number;
}

interface WorldData {
  pieces: CompactPiece[];
  camera: { x: number; y: number; zoom: number };
  records: {
    combo: number;
    speed: number;
    airTime: number;
    marbles: number;
    bestDrop: number;
    loops: number;
    goals: number;
  };
}

// [defIndex, x, y, rot16, color, len, variant]
type CompactPiece = [number, number, number, number, number, number, number];
```

- `defIndex` referencia un array estable de IDs en el código (nunca se reordena; se añaden al final).
- `x`, `y` redondeados a 0,1 u; `rot16` = grados × 16 (precisión 0,06°); `len` en u; `color` índice; `variant` entero.
- 2.000 piezas ≈ 120 KB de JSON; muy por debajo del límite de 5 MB de `localStorage`.
- Se guardan 3 mundos + un backup del último guardado válido.

### 12.2 Cuándo se guarda

- Tras una edición, con **debounce de 1,5 s**.
- Al cambiar de modo, al abrir/cerrar un overlay y al comprar.
- En `pagehide` y `visibilitychange` (iOS no siempre dispara `beforeunload`).
- Al cumplir un reto o batir un récord.
- Nunca en el bucle de render ni en el de física.

### 12.3 Migraciones y errores

- `v` permite migrar secuencialmente (`v1 → v2 → ...`).
- Antes de migrar, se copia el guardado a `marblelous.backup`.
- Si el JSON es inválido: se intenta el backup; si también falla, se arranca con un mundo nuevo y se muestra un icono de aviso (disquete con “!”), sin texto.
- Si `localStorage` falla por cuota o modo privado: se juega en memoria y se muestra el aviso; la sesión funciona, pero no persiste.
- No se guardan datos personales, ni ubicación, ni identificadores.

### 12.4 Exportación / importación (v1.1, opcional)

- Exportar: descarga un `.json` con el mundo activo (sin progreso) para compartirlo.
- Importar: selector de archivo; se valida y se coloca en un mundo libre.
- No hay servidor ni enlaces mágicos en v1. Se evalúa añadir enlaces comprimidos en v1.1 si el tamaño lo permite.

---

## 13. Compatibilidad iOS/Safari

| Problema | Mitigación |
|---|---|
| Zoom de página por pellizco | `touch-action: none` en `html, body, canvas`; `user-scalable=no` en viewport (con alternativa de zoom in-game por accesibilidad). |
| Rebote elástico / scroll de la página | `overscroll-behavior: none`; `position: fixed`; `overflow: hidden`. |
| Selección de texto / menú contextual | `user-select: none`; `-webkit-touch-callout: none`. |
| Doble toque hace zoom | `touch-action: none`; umbral de tap propio. |
| `100vh` incorrecto con barras | `100dvh` con fallback a `100vh` y `visualViewport`; listener de resize. |
| Safe areas (isla, indicador de inicio) | `env(safe-area-inset-*)` en HUD y bandeja; `viewport-fit=cover`. |
| Audio bloqueado hasta gesto | Crear/reanudar el contexto en el primer `pointerdown`; buffer silencioso. |
| Audio interrumpido por llamada/bloqueo | `visibilitychange` → `suspend`; al volver, `resume`; recrear si es necesario. |
| Contexto de audio en estado raro | Escuchar `statechange`; reintentar `resume` en el siguiente toque. |
| rAF limitado en modo de bajo consumo | `dt` con tope; calidad adaptativa; no acumular tiempo. |
| Memoria limitada | DPR ≤ 2; sprites LRU; sin texturas grandes; medir con Web Inspector. |
| `OffscreenCanvas` no disponible en iOS antiguo | No se usa; se usan canvas DOM fuera de pantalla. |
| `roundRect` no disponible en iOS < 16 | Función de dibujo propia con arcos y líneas. |
| `PointerEvent` con `pointercancel` | Cancelación limpia de gestos; sin estados colgados. |
| Gestos del sistema (desde el borde) | No se puede impedir; se diseña para que un gesto cancelado no borre ni compre nada. |
| Orientación | Se soportan ambas; reflow con debounce; no se bloquea. |
| Modo privado / cuota | Juego en memoria + aviso icónico; no se pierde la sesión. |
| Service worker en modo privado | Se ignora si falla; el juego sigue online. |
| Fuentes | Solo del sistema; sin descargas ni FOUT. |

**Navegadores objetivo:** Safari iOS/iPadOS 15+, Chrome/Edge/Safari de escritorio recientes, Chrome Android como extra. No se soporta IE.

---

## 14. Calidad, pruebas y criterios de aceptación

### 14.1 Estrategia de pruebas

- **Unitarias (Vitest):** matemáticas, colisión círculo-cápsula, colisión círculo-círculo, sueño, serialización, economía, retos. El núcleo no depende del DOM.
- **Integración:** mundo con rampa + canica + xilófono + meta; se simulan 10 s y se comprueba que hay notas, puntos y que la canica llega.
- **E2E (Playwright, opcional):** cargar, arrastrar una pieza, soltar una canica, abrir tienda, comprar con saldo simulado, recargar y comprobar persistencia.
- **Rendimiento:** escena de estrés (`?scene=stress`) con 1.500 piezas y 200 canicas; medir frame time, memoria y voces de audio durante 5 min.
- **Dispositivo real:** iPad 6 (A10), iPad 9 (A13), iPad Pro; Safari; orientación horizontal y vertical; modo de bajo consumo; 30 min de sesión.
- **Pruebas con niños:** 5 sesiones moderadas de 20 min con niños de 8–11 años; tareas: “haz que suene”, “construye algo alto”, “compra algo”. Observar sin ayudar.

### 14.2 Casos de prueba críticos

| Caso | Resultado esperado |
|---|---|
| Canica a 2.800 u/s contra pared de 10 u | No atraviesa; rebota. |
| Canica en reposo sobre rampa de 30° | Permanece o rueda lentamente; no vibra. |
| 200 canicas en un embudo | Se estabilizan; fps ≥ 30; sin explosión. |
| Bucle con velocidad insuficiente | La canica cae; no se otorgan puntos. |
| Bucle con velocidad suficiente | Se otorgan 60 y efecto. |
| Misma lámina golpeada 20 veces en 1 s | Suena, pero no puntúa más de una vez por ventana. |
| Comprar sin saldo | No se compra; feedback suave. |
| Guardar 2.000 piezas, recargar | Se restauran todas, cámara y progreso. |
| Guardado corrupto | Se recupera el backup o se arranca limpio con aviso. |
| Rotar durante pinch | No se rompe el estado; la pieza queda en su sitio. |
| Cambiar de app a mitad de tirada | Se pausa, se guarda; al volver, todo consistente. |
| Orientación vertical | HUD y bandeja se reflowan; nada queda bajo el notch. |

### 14.3 Criterios de aceptación (v1)

- **Funcional:** todas las piezas v1 colocables, borrables, rotables y persistentes; canicas lanzables; sonido en cada lámina; puntos; tienda; retos; 3 mundos.
- **Táctil:** ninguna acción principal requiere leer; todos los targets ≥ 56 px; pinch, pan y drag funcionan con dos dedos; no hay gestos accidentales en el 95 % de las pruebas.
- **Rendimiento:** 60 fps en iPad 6 con 100 canicas y 800 piezas; 30 fps mínimo en el peor caso; arranque < 1,5 s; bundle < 150 KB gzip.
- **Audio:** sin clics, sin saturación, sin notas disonantes; 16 voces máximo; silencio funcional.
- **Persistencia:** ningún dato perdido en 50 ciclos de recarga; migración probada.
- **Accesibilidad:** navegación por teclado en escritorio; `aria-label` en todos los controles; contraste; reducción de movimiento.
- **Offline:** segunda carga sin red funciona al 100 %.
- **Legal:** sin marcas de LEGO, sin assets de terceros, sin datos personales.

### 14.4 Depuración

- `?debug=1`: overlay con fps, ms de física/render/audio, canicas despiertas, colisionadores, voces, calidad, memoria (si `performance.memory` existe).
- `?scene=stress`: carga una escena de estrés reproducible.
- `?reset`: borra el guardado local (con confirmación de URL, solo desarrollo).
- `?world=2`: carga un mundo concreto.
- El overlay se activa con 3 toques en la esquina superior izquierda en producción (gesto oculto para soporte).

### 14.5 Matriz de dispositivos

| Dispositivo | Prioridad | Objetivo |
|---|---|---|
| iPad 6 (A10, 2018) | **P0** | 60 fps con 100 canicas / 800 piezas; 30 fps en estrés. |
| iPad 9 (A13, 2021) | P0 | 60 fps con 200 canicas / 1.500 piezas. |
| iPad 5 (A9, 2017) | P1 | 30 fps estables con 60 canicas / 500 piezas en calidad baja. |
| iPad Air 2 (A8X, 2014) | P2 | 30 fps mínimo; calidad baja; si no llega, se avisa en la web. |
| iPad Pro 11" | P1 | 60 fps, DPR 2. |
| iPhone 12+ | P2 | Jugable en horizontal; HUD adaptado. |
| Mac/PC Chrome | P1 | Ratón + teclado; 60 fps. |
| Android tablet | P2 | Chrome; rendimiento variable. |

---

## 15. Privacidad, legal y accesibilidad

### 15.1 Privacidad

- **Cero recogida de datos.** No hay analítica, ni cookies, ni cuentas, ni publicidad, ni SDKs de terceros.
- Todo se guarda en `localStorage` del dispositivo.
- No hay peticiones de red después de la carga (salvo la actualización del service worker).
- Apto para menores: no se solicita edad, nombre, email ni ubicación. Diseñado para ser compatible con COPPA y GDPR-K: sin datos, sin cuentas, sin publicidad.
- Si en el futuro se añade analítica, será agregada, anónima y con consentimiento parental; no en v1.

### 15.2 Legal y marca

- **Nombre:** “Marblelous” debe verificarse como marca y dominio antes del lanzamiento. Hay juegos y apps con nombres similares; se recomienda una búsqueda de marca en España/UE y una comprobación en App Store/Google Play. Alternativas: “Canicario”, “Marmolina”, “Taller de Canicas”, “Rodal”.
- **LEGO:** no se usa la marca, el logo, las minifiguras ni el nombre “LEGO”. Los ladrillos son genéricos y estilizados; los tetones son un recurso visual común en juguetes de construcción. Aun así, se recomienda revisar el trade dress en la jurisdicción de lanzamiento y mantener una estética propia (proporciones, colores, formas redondeadas).
- **Audio:** 100 % sintetizado; no hay samples de terceros.
- **Código:** sin dependencias de runtime; licencias de desarrollo (Vite, TypeScript, Vitest) compatibles.
- **Fuentes:** del sistema; no se distribuyen fuentes.

### 15.3 Accesibilidad

- Contraste y formas ya descritos.
- Navegación por teclado en escritorio: flechas para mover la cámara, `+`/`-` para zoom, `Espacio` para soltar una canica en el centro de la vista, `Supr` para borrar, `Cmd/Ctrl+Z` y `Cmd/Ctrl+Shift+Z` para deshacer/rehacer.
- Foco visible en todos los botones; los overlays atrapan el foco y se cierran con `Esc`.
- `aria-live="polite"` para el contador de chispas y los hitos, sin ser verboso.
- Modo de reducción de movimiento.
- El juego no depende del audio para completar ninguna acción.
- Se documenta una guía de accesibilidad en la página de créditos (texto permitido ahí).

---

## 16. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Tunneling o inestabilidad física a alta velocidad | Media | Alto | Tope de velocidad + substeps + cápsulas gruesas + tests de estrés. |
| Jitter en reposo (canicas vibrando) | Alta | Medio | Slop, umbral de rebote, resistencia a la rodadura, sueño, 2 iteraciones. |
| Rendimiento insuficiente en iPad 6 | Media | Alto | Sprites, culling, LOD, DPR adaptativo, presupuesto y pruebas desde la semana 1. |
| Audio bloqueado o entrecortado en iOS | Alta | Medio | Desbloqueo en primer gesto, reanudación, límite de voces, compresor; probar en dispositivo real pronto. |
| Conflictos de gestos (pinch vs drag vs drop) | Alta | Alto | Máquina de estados explícita, umbrales, cancelación con segundo dedo, pruebas con niños. |
| Compras accidentales | Media | Medio | Dos pasos, tarjeta expandida, sin compra por toque simple. |
| Pérdida de guardado | Baja | Alto | Autosave, backup, migraciones, manejo de cuota, pruebas de recarga. |
| Scope creep (balancín, portales, multijugador) | Alta | Medio | Catálogo v1 cerrado; v1.1/v2 separados; revisión de cambios. |
| Marca “Marblelous” conflictiva | Media | Alto | Búsqueda de marca antes de lanzar; alternativas listas. |
| Estética demasiado infantil o demasiado fría | Media | Medio | Pruebas con niños y adultos; paleta desaturada; sin mascotas. |
| Economía desbalanceada (grind o todo gratis) | Media | Medio | Pruebas de ritmo; panel de depuración; ajustar precios, no la diversión. |
| World size / almacenamiento | Baja | Medio | Límite 2.000 piezas; compactación; aviso de cuota. |
| Safari cambia comportamiento | Baja | Medio | Capa de abstracción de input/audio; pruebas en versiones nuevas. |
| Falta de textos = confusión | Media | Alto | Tutorial sin texto, pictogramas animados, pruebas de usabilidad; textos accesibles solo para lectores de pantalla. |

---

## 17. Plan de implementación

Estimación para **1 desarrollador senior + apoyo de diseño/audio puntual**. Si se trabaja a tiempo completo, ~6 semanas; con un equipo pequeño (2–3 personas), 4–5 semanas.

### Hito 0 — Fundaciones (2 días)

- Repo, Vite, TypeScript estricto, lint, CI, deploy en GitHub Pages.
- Canvas a pantalla completa, DPR, resize, cámara con pan/zoom, rejilla.
- Bucle de rAF con paso fijo y overlay de debug.
- **Salida:** una pantalla vacía navegable en el iPad.

### Hito 1 — Física y canicas (4–5 días)

- Mundo de colisionadores, broadphase, círculo-cápsula, integración, substeps.
- Canica de cristal, gravedad, sueño, colisión canica-canica.
- Ladrillo y rampa; escena de prueba; tests unitarios.
- **Salida:** una canica rueda por una rampa y se detiene sin vibrar; 200 canicas no rompen.

### Hito 2 — Construcción táctil (4–5 días)

- Bandeja, arrastrar y soltar, snap, selección, rotar, borrar, deshacer.
- Cámara con pinch/pan, cancelación de gestos, recentrar.
- Serialización y autosave; límites.
- **Salida:** se puede construir y guardar un escenario completo en iPad.

### Hito 3 — Sonido y xilófono (3–4 días)

- Motor de audio, buses, compresor, desbloqueo iOS.
- Síntesis de xilófono, impactos, trampolín, UI.
- Láminas y racks; eventos de física → audio.
- **Salida:** una canica golpea una lámina y suena bien; 16 voces sin saturar.

### Hito 4 — Juego, economía y tienda (4–5 días)

- Puntuación, combo, chispas, resumen de tirada.
- Tienda con previsualizaciones, compra, persistencia.
- Retos, récords, 3 mundos.
- **Salida:** bucle completo construir → soltar → ganar → comprar → construir.

### Hito 5 — Contenido y pulido (5–6 días)

- Catálogo v1 completo (rampas curvas, trampolín, bucle, embudo, propulsor, cañón, cinta, parachoques, estrella, meta, imán).
- Tutorial sin texto, onboarding, feedback, partículas, animaciones.
- Dirección de arte final, sprites, iconos.
- **Salida:** el juego se siente “terminado” en una sesión de 20 min.

### Hito 6 — Rendimiento, QA y lanzamiento (4–5 días)

- Pruebas en iPad 6/9, perfilado, calidad adaptativa, memoria.
- PWA/offline, manifest, iconos, service worker.
- Pruebas con niños, ajustes de economía y gestos.
- QA final, accesibilidad, legal, deploy.
- **Salida:** versión 1.0 publicada en GitHub Pages.

### Backlog posterior (v1.1)

- Portal, meta dorada, balancín, molinete.
- Exportar/importar mundos.
- Temas de fondo (3 papeles) y colores extra.
- Replays de tiradas (grabación de posiciones).
- Modo “seguir canica” opcional.
- Retos generados semanalmente (sin servidor, por fecha local).
- Enlaces para compartir un mundo (si el tamaño lo permite).

---

## 18. Decisiones abiertas para revisión

Marca con ✓ o corrige. Las recomendaciones están en negrita.

| # | Decisión | Opciones | Recomendación |
|---:|---|---|---|
| 1 | **Nombre** | Marblelous / Canicario / Marmolina / Taller de Canicas | **Verificar “Marblelous”**; si hay conflicto, “Canicario”. |
| 2 | **Orientación** | Solo horizontal / ambas | **Ambas**, horizontal por defecto. |
| 3 | **Moneda** | Chispas / Cuarzo / Estrellas | **Chispas (✦)**. |
| 4 | **Portales y meta dorada en v1** | Sí / v1.1 | **v1.1**, para proteger estabilidad. |
| 5 | **Balancín y molinete** | v1 / v1.1 / v2 | **v1.1 / v2**. |
| 6 | **Número de mundos** | 1 / 3 / 5 | **3**. |
| 7 | **Guardado** | Solo local / local + exportar | **Local en v1**, exportar en v1.1. |
| 8 | **PWA offline** | Sí / No | **Sí**. |
| 9 | **Tutorial** | 4 pasos / 6 pasos / sin tutorial | **4 pasos**, omitible. |
| 10 | **Estilo de ladrillo** | Con tetones / sin tetones | **Con tetones estilizados** (sin marca LEGO). |
| 11 | **Paleta** | Cálida (papel) / fría (gris azulado) / oscura | **Cálida `#F2EFE7`**. |
| 12 | **Sonido** | 3 niveles / slider / mute | **3 niveles**. |
| 13 | **Canicas** | 5 / 8 | **5** en v1. |
| 14 | **Precios** | Los de la tabla / más baratos / más caros | **Los de la tabla**, ajustar tras playtest. |
| 15 | **Texto en tienda** | Cero texto / nombres cortos | **Cero texto** (solo pictogramas y precios). |

**Preguntas que conviene responder antes de implementar:**

1. ¿El nombre “Marblelous” es definitivo? ¿Quieres que verifique disponibilidad de dominio/marca?
2. ¿Prefieres que el juego arranque directo en el mundo (recomendado) o con una portada con botón de play?
3. ¿Quieres incluir portales y balancín en la primera versión aunque retrasen 1–2 semanas el lanzamiento?
4. ¿La estética debe ser más “juguete de madera” (cálida, xilófono) o más “plástico de construcción” (colores más saturados)? La propuesta mezcla ambas.
5. ¿Hay algún límite de tamaño de escenario que quieras fijar (para asegurar rendimiento) o mantenemos el límite blando de 2.000 piezas?

---

## 19. Anexos

### Anexo A — Constantes de referencia rápida

```
MUNDO
  unidad ................ 1 u ≈ 1 px CSS a zoom 1
  rejilla fina .......... 20 u
  módulo ladrillo ....... 80 × 40 u
  chunk ................. 512 × 512 u
  zoom .................. 0,3 – 2,5 (inicio 1,0)
  límite de piezas ...... 2.000 por mundo
  mundos ................ 3

FÍSICA
  gravedad .............. 1.800 u/s²
  paso fijo ............. 1/120 s
  velocidad máxima ...... 2.800 u/s
  radio canica .......... 8,5 – 9,5 u
  umbral de sueño ....... 22 u/s durante 0,6 s
  slop .................. 0,5 u
  corrección ............ 90 %
  rebote mínimo ......... 80 u/s
  substeps .............. 1–8
  canicas activas ....... 200
  canicas dormidas ...... 80

RENDER
  DPR ................... min(devicePixelRatio, 2)
  partículas ............ 256 (alta), 120 (media), 48 (baja)
  popups ................ 6
  estelas ............... 12 puntos, 30 canicas
  sprites en caché ...... ~80
  presupuesto frame ..... 16,7 ms

AUDIO
  voces ................. 16
  compresor ............. −18 dB, 4:1
  master ................ 0,8
  notas ................. pentatónica Do mayor, 2 octavas
```

### Anexo B — Frecuencias del xilófono

| Índice | Nota | Hz | Duración base |
|---:|---|---:|---:|
| 0 | Do4 | 261,63 | 1,6 s |
| 1 | Re4 | 293,66 | 1,5 s |
| 2 | Mi4 | 329,63 | 1,4 s |
| 3 | Sol4 | 392,00 | 1,2 s |
| 4 | La4 | 440,00 | 1,1 s |
| 5 | Do5 | 523,25 | 1,0 s |
| 6 | Re5 | 587,33 | 0,9 s |
| 7 | Mi5 | 659,25 | 0,8 s |

- Parciales: 1,00 / 2,76 / 5,40 / 8,93; amplitudes 1 / 0,35 / 0,18 / 0,09.
- Ataque 4 ms; transitorio de ruido 8 ms; detune ±3 cents.

### Anexo C — Ejemplo de guardado compacto

```json
{
  "v": 1,
  "updatedAt": 1763222400000,
  "currency": 1240,
  "lifetime": 4820,
  "owned": ["brick2", "brick4", "plate4", "ramp", "rampCurve", "trampoline", "xylo3", "goal", "crystal", "rubber"],
  "activeWorld": 0,
  "worlds": [
    {
      "pieces": [
        [0, 120, 200, 0, 0, 0, 0],
        [3, 300, 240, 256, 1, 160, 0],
        [8, 460, 320, 0, 0, 0, 0]
      ],
      "camera": { "x": 300, "y": 240, "zoom": 1.0 },
      "records": { "combo": 3, "speed": 2100, "airTime": 1800, "marbles": 14, "bestDrop": 860, "loops": 2, "goals": 9 }
    }
  ],
  "settings": { "sound": 2, "quality": "auto", "leftHanded": false, "reduceMotion": false, "haptics": false, "tutorialSeen": true },
  "challenges": { "firstGoal": 1, "loop": 1 },
  "tutorialStep": 4
}
```

### Anexo D — Workflow de GitHub Pages

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- `vite.config.ts`: `base: './'`, `build.target: 'es2020'`, `build.assetsInlineLimit: 4096`.
- Añadir `npm run size` con un presupuesto de 150 KB gzip.

### Anexo E — Glosario

| Término | Significado |
|---|---|
| **u** | Unidad de mundo; ~1 px CSS a zoom 1. |
| **Chunk** | Celda de 512 × 512 u para indexar piezas y colisionadores. |
| **Cápsula** | Segmento con radio; forma de colisión principal. |
| **Trigger** | Zona sin colisión que dispara un efecto (meta, estrella, propulsor...). |
| **Tirada** | Secuencia desde que se suelta la primera canica hasta que todas duermen o se limpian. |
| **Cadena** | Contador de eventos puntuables consecutivos; alimenta el multiplicador. |
| **Combo** | Multiplicador derivado de la cadena. |
| **Chispas** | Moneda y marcador. |
| **LOD** | Nivel de detalle de un sprite según el zoom. |
| **DPR** | Device pixel ratio; densidad de píxeles del dispositivo. |
| **Broadphase** | Fase de descarte rápido de colisiones. |
| **Sleeping** | Canica en reposo que deja de simularse. |
| **PWA** | Aplicación web instalable y offline. |

### Anexo F — Checklist de revisión

- [ ] El concepto y el bucle me convencen.
- [ ] La lista de piezas v1 es suficiente / sobra / falta algo.
- [ ] Los precios y el ritmo económico me parecen razonables.
- [ ] La estética (paleta cálida, tetones, sin texto) es la deseada.
- [ ] El enfoque iPad-first y los gestos son correctos.
- [ ] Los límites (2.000 piezas, 200 canicas, 3 mundos) son aceptables.
- [ ] Acepto el plan de 6 semanas / quiero ajustar el alcance.
- [ ] Las decisiones abiertas de la sección 18 están resueltas.
- [ ] El nombre “Marblelous” se mantiene / se cambia.
- [ ] Quiero que se implemente tal cual / con los cambios anotados.

---

*Fin de la especificación. Cualquier cambio de alcance se refleja primero aquí y luego en el código.*
