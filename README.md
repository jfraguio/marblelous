# Marblelous

Un taller infinito de canicas, rampas y música, con piezas en perspectiva 2.5D. Hecho para jugar en iPad con el dedo, pero funciona con ratón y teclado.

## Jugar

Abre la página publicada en GitHub Pages:

```
https://fraguio.com/marblelous/
```

La URL de GitHub Pages (`https://jfraguio.github.io/marblelous/`) redirige al dominio configurado.

- La primera vez se abre un taller vacío en el mundo **Normal**, con la vibración activada en los ajustes. En las siguientes sesiones se abre el último taller que estabas usando.
- En **Ajustes → Álbum de talleres** puedes crear un lienzo vacío, poner nombre a tus circuitos y abrirlos desde sus miniaturas. Cada taller se guarda automáticamente. Las partidas de versiones anteriores se incorporan al álbum.
- Toca una pieza de la bandeja y después toca el lienzo para colocarla. La pieza se deselecciona al colocarla: para poner otra, vuelve a tocarla en la bandeja.
- Mantén pulsada una pieza en la bandeja para dejarla **fijada**: cada toque en el lienzo coloca una copia. Vuelve a tocarla en la bandeja (o toca otra pieza) para deseleccionarla.
- Toca una pieza ya colocada para seleccionarla. Los botones flotantes permiten rotarla, duplicarla, cambiar su longitud (rampas) o borrarla. Cada pieza nueva recibe un color aleatorio de la paleta.
- **Ajuste fino** mueve la pieza seleccionada cuatro píxeles por pulsación sin activar el imán (`Alt` + flechas con teclado). Con teclado, `T` permite soltar una sola canica con el siguiente toque en el lienzo, sin salir de Construir ni detener las fábricas.
- Las rampas y cintas son algo más gruesas y tienen una zona de toque generosa: se pueden agarrar un poco por encima o por debajo de la barra para moverlas.
- Cambia a la canica y toca el lienzo para soltar una; mantén pulsado para hacer lluvia.
- Dos dedos para mover y hacer zoom. Los botones **+** y **−**, bajo el botón de centrar, acercan y alejan el lienzo.
- Todas las piezas y canicas están disponibles desde el principio. No hay puntos, récords ni tienda.
- La barra superior permite pausar la simulación (`P` con teclado). Puedes deshacer y rehacer con `Ctrl` o `⌘` + `Z` (añade `Mayús` para rehacer).
- En Ajustes > Mundos puedes cambiar el fondo de tu circuito: Normal, Fondo marino, Cielo, Espacio, Volcán y Jardín.
- La **Fábrica de burbujas** atrapa la canica en un aro de jabón y la hace flotar. El **Ventilador** puede desviarla y la burbuja estalla al tocar cualquier pieza, lo que permite crear tramos aéreos. Si la canica azul entra en una burbuja, todas las canicas azules del lienzo se meten en burbuja a la vez.
- La **Fábrica de canicas** produce una canica por segundo mientras está encendida, del mismo tipo que la canica seleccionada en la bandeja. Su lucecita es verde cuando funciona y roja cuando está apagada; se cambia con el botón de encendido al seleccionarla o tocándola en modo Jugar. La canica sale por su boca inferior y cae con la gravedad.
- Los extremos compatibles se **imantan** al acercarlos, sin cambiar su rotación. Un anillo marca la unión en la vista previa y un clic confirma el encaje. El **Canal en S** enlaza dos tramos a distinta altura. Los **propulsores** se pegan a la pista y quedan suspendidos justo encima.
- El **Ventilador** toma las canicas por los lados de la base y las eleva por su tubo. En el **Embudo**, las canicas ruedan tras el cristal y salen por el cuello; puedes ensanchar la boca sin cambiar la salida.
- La **Bifurcación** alterna izquierda y derecha. Si la colocas boca abajo, reúne las canicas de las dos patas en la salida central. El **Dosificador** guarda las canicas en fila y las deja salir cada 0,45, 0,8 o 1,25 segundos de simulación. Usa el botón **Afinar xilófono** para cambiar la nota de cada lámina entre Do, Re, Mi, Sol y La.
- El **Balancín** se inclina hacia el lado donde cae la canica: si el peso es suficiente, la hace rodar y caer por ese extremo.
- El **Electroimán** atrae o repele las canicas cercanas. Se cambia de polaridad con el botón de imán al seleccionarlo o tocándolo directamente en modo Jugar; las canicas de acero responden con mucha más fuerza.
- La **canica plasma** (violeta) se parte en dos al caer en un **cañón**: las dos mitades salen disparadas hacia arriba.
- El **Reloj de arena** estalla al tocarlo una canica y ralentiza el tiempo cinco segundos. Vuelve a aparecer cinco segundos después de que el tiempo se restaure.
- La **Rampa-burbuja** es una placa de hielo quebradizo: aguanta un instante y se rompe bajo el peso de una canica.
- La **Canica sorpresa** sale como un círculo con `?` en la bandeja: al lanzarla aparece una canica aleatoria de entre todas.
- La **Canica arcoíris** tiene un 10% de posibilidades de hacer explotar a cualquier canica con la que choque. Esas explosiones lanzan fuegos artificiales el triple de grandes.
- En Ajustes puedes elegir sonido **Normal**, **Suave** o **Silencio**. La calidad **Automática** se adapta al dispositivo; **Ligera** reduce la resolución, las sombras y las estelas y limita el dibujo a unos 30 fotogramas por segundo.
- Los portales pueden separar sus dos agujeros con el botón de tamaño.
- En Ajustes, **Limpiar canicas** retira todas las canicas del lienzo. **Vaciar taller** también quita las piezas, conserva una copia en el álbum y se puede deshacer.
- En el álbum hay seis circuitos cortos y una colección de estructuras clásicas. Cada ejemplo se abre como un taller editable y el anterior queda guardado. **Mi primera brisa** te guía para soltar una canica y cambiar su recorrido. **Dos voces** muestra la Bifurcación; **Un pulso** muestra el Dosificador.

## Desarrollo

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

Sin dependencias de runtime. Canvas 2D, motor de física propio, audio sintetizado con Web Audio y persistencia local.

## Despliegue

El workflow `.github/workflows/deploy.yml` compila y publica `dist` en GitHub Pages al hacer push a `main`.

## Privacidad

No hay cuentas, analítica, publicidad ni peticiones de red después de la carga. El progreso se guarda únicamente en el dispositivo (`localStorage`).
