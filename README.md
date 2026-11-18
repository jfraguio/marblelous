# Marblelous

Un taller infinito de canicas, rampas y música, con piezas en perspectiva 2.5D. Hecho para jugar en iPad con el dedo, pero funciona con ratón y teclado.

## Jugar

Abre la página publicada en GitHub Pages:

```
https://fraguio.com/marblelous/
```

La URL de GitHub Pages (`https://jfraguio.github.io/marblelous/`) redirige al dominio configurado.

- Toca una pieza de la bandeja y después toca el lienzo para colocarla. La pieza se deselecciona al colocarla: para poner otra, vuelve a tocarla en la bandeja.
- Toca una pieza ya colocada para seleccionarla. Los botones flotantes permiten rotarla, cambiar color, duplicarla, cambiar su longitud (rampas) o borrarla.
- Cambia a la canica y toca el lienzo para soltar una; mantén pulsado para hacer lluvia.
- Dos dedos para mover y hacer zoom.
- Todas las piezas y canicas están disponibles desde el principio. No hay tienda.
- En ajustes, “Borrar canvas” vacía el escenario actual; puedes deshacerlo.
- El botón del cubo abre el **Viaje 3D**: un recorrido de canicas con tubo de cristal, sacacorcho, espiral, anillos musicales y cámara en primera persona. Se carga aparte y no afecta al taller 2D.

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
