# Marblelous

Un taller infinito de canicas, rampas y música. Hecho para jugar en iPad con el dedo, pero funciona con ratón y teclado.

## Jugar

Abre la página publicada en GitHub Pages:

```
https://jfraguio.github.io/marblelous/
```

- Arrastra piezas desde la bandeja al lienzo.
- Toca una pieza para seleccionarla; usa los botones flotantes para rotar o borrar.
- Cambia a la canica, toca el lienzo para soltar una canica y mantén pulsado para hacer lluvia.
- Dos dedos para mover y hacer zoom.
- La tienda se abre desde la bolsa de la bandeja o desde el contador de chispas.

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
