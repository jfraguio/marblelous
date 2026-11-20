# Marblelous

Un taller infinito de canicas, rampas y música, con piezas en perspectiva 2.5D. Hecho para jugar en iPad con el dedo, pero funciona con ratón y teclado.

## Jugar

Abre la página publicada en GitHub Pages:

```
https://fraguio.com/marblelous/
```

La URL de GitHub Pages (`https://jfraguio.github.io/marblelous/`) redirige al dominio configurado.

- Toca una pieza de la bandeja y después toca el lienzo para colocarla. La pieza se deselecciona al colocarla: para poner otra, vuelve a tocarla en la bandeja.
- Mantén pulsada una pieza en la bandeja para dejarla **fijada**: cada toque en el lienzo coloca una copia. Vuelve a tocarla en la bandeja (o toca otra pieza) para deseleccionarla.
- Toca una pieza ya colocada para seleccionarla. Los botones flotantes permiten rotarla, duplicarla, cambiar su longitud (rampas) o borrarla. Cada pieza nueva recibe un color aleatorio de la paleta.
- Las rampas, trampolines y cintas son algo más gruesas y tienen una zona de toque generosa: se pueden agarrar un poco por encima o por debajo de la barra para moverlas.
- Cambia a la canica y toca el lienzo para soltar una; mantén pulsado para hacer lluvia.
- Dos dedos para mover y hacer zoom.
- Todas las piezas y canicas están disponibles desde el principio. No hay tienda.
- En Ajustes > Mundos puedes cambiar entre cuatro escenarios con fondos detallados: Normal, Fondo marino, Cielo y Espacio.
- La **Fábrica de burbujas** atrapa la canica en un aro de jabón y la hace flotar. El **Ventilador** puede desviarla y la burbuja estalla al tocar cualquier pieza, lo que permite crear tramos aéreos.
- Los extremos de las rampas, curvas, embudos, cintas, trampolines, espirales, fábricas de burbujas, ventiladores y propulsores se **imantan** al acercarlos, sin cambiar su rotación.
- La **Rampa-burbuja** es una placa de hielo quebradizo: aguanta un instante y se rompe bajo el peso de una canica.
- La **Canica sorpresa** sale como un círculo con `?` en la bandeja: al lanzarla aparece una canica aleatoria de entre todas.
- La **Canica arcoíris** explota en fuegos artificiales solo al chocar con otra canica arcoíris.
- El sonido está siempre activado; no hay control de volumen.
- Los portales pueden separar sus dos agujeros con el botón de tamaño.
- En ajustes, “Borrar canvas” vacía el escenario actual; puedes deshacerlo.

## Desarrollo

```bash
npm install
npm run dev
npm run build
npm run preview
```

Sin dependencias de runtime. Canvas 2D, motor de física propio, audio sintetizado con Web Audio y persistencia local.

## Despliegue

El workflow `.github/workflows/deploy.yml` compila y publica `dist` en GitHub Pages al hacer push a `main`.

## Privacidad

No hay cuentas, analítica, publicidad ni peticiones de red después de la carga. El progreso se guarda únicamente en el dispositivo (`localStorage`).
