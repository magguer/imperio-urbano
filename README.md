# 🏙️ Imperio Urbano

Juego de mesa local multijugador inspirado en los clásicos juegos de propiedades, con tema y contenido original.

## Cómo jugar

1. Instala dependencias (opcional, para actualizar la librería de dados):

```bash
npm install
```

2. Inicia el servidor local:

```bash
npm start
```

Luego abre la URL que aparece en la terminal. Por defecto intenta `http://localhost:8765`; si ese puerto está ocupado, usa el siguiente libre.

> También puedes abrir `index.html` directamente, pero el servidor local es recomendado (dados 3D, módulos ES y guardado de partida).

3. Elige 2–6 jugadores y ponles nombre.
4. **Pasa el dispositivo** al jugador en turno — es multijugador local (hot-seat).
5. El último jugador sin quebrar gana.

## Mecánicas incluidas

- Tablero de 40 casillas con 8 grupos de propiedades
- Compra, alquileres y construcción de casas/hoteles
- **Negociación**: intercambia propiedades, dinero y cartas de salida
- **Subastas** cuando un jugador no compra una propiedad
- Estaciones de Metro (alquiler escalonado por cantidad)
- Servicios públicos (Agua y Energía)
- Cartas de Sorpresa Ciudad y Fortuna
- Comisaría (cárcel), Zona Libre con fondo acumulado, impuestos
- Hipotecas (10% interés al recuperar), quiebra y gestión de activos
- No se puede construir con propiedades hipotecadas en el grupo
- Patrimonio neto visible por jugador
- Dados 3D con regla de dobles (3 dobles → Comisaría)
- Guardado automático de partida (localStorage) y copia de seguridad
- $200 al pasar por SALIDA

## Tema original

Nombres, cartas y diseño son propios para evitar problemas de copyright. La diversión es la misma: ¡compra barato, cobra caro y domina la ciudad!
