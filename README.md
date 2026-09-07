# sistema-futbol

Implementación del **Prompt Maestro: Analizador Probabilístico de Partidos de Fútbol**.

El prompt describe un contrato de datos muy estricto para que una app de HTML/CSS/JavaScript
consuma el análisis sin limpiar nada. Este repositorio contiene las dos mitades de ese contrato:

1. **`PROMPT_MAESTRO.md`** — el prompt completo, listo para pegar como instrucción de sistema en
   un modelo de lenguaje.
2. **La aplicación** — un motor que realiza el análisis y cálculo probabilístico, a partir de los datos que tú introduces en la interfaz.

La regla R1 del prompt («no inventar datos») es la razón de ser del motor: en lugar de pedirle a
un modelo que estime probabilidades de memoria, el sistema las deriva de números que tú aportas.
Si falta un dato, no se rellena: el campo sale como `null`.

## Uso

Puedes abrir el archivo `index.html` directamente en tu navegador (haciendo doble clic sobre él) ya que toda la lógica se ejecuta del lado del cliente. 

Si prefieres servirlo por HTTP localmente, puedes hacerlo con Python:

```bash
python -m http.server 8090
```

Y abre <http://localhost:8090>.

### Pestañas

| Pestaña | Para qué sirve |
| --- | --- |
| **Datos** | Datos del encuentro, promedios de goles, forma, bajas, descanso y cuotas. |
| **Resultado** | Probabilidades, mercados, pronóstico principal, alternativa, mercado a evitar, escenarios y factores clave. |

El JSON generado encaja directamente con el proyecto hermano `PRONOSTICOBETPLAY`, que consume
este mismo esquema.

## Cómo estima

`js/modelo.js` construye una matriz de marcadores con **Poisson bivariado y corrección
Dixon-Coles** (`rho = -0,05`) para los resultados bajos, donde el Poisson independiente subestima
los empates:

1. Fuerzas de ataque y defensa de cada equipo, normalizadas por la media de goles de la
   competición.
2. Goles esperados: `ataque propio × defensa rival × media por equipo`.
3. Ajustes de contexto acotados —forma reciente (±12 %), bajas (hasta −17,5 %), descanso
   (±1,5 % por día, tope 4 días)— con un recorte global de ±30 %: §16 exige que ningún factor
   aislado domine el análisis.
4. Todos los mercados salen de la misma matriz, así que son coherentes entre sí por
   construcción: `over + under = 1`, `BTTS sí + no = 1`, `1 + X + 2 = 1`.

Los promedios se esperan **separados por localía** (goles del local en casa, del visitante fuera).
Si sólo tienes promedios globales, marca la casilla correspondiente y se aplica el factor de
ventaja de localía.

## Riesgo, confianza y selección

- **Riesgo** (§11–§12): se acumula incertidumbre de fuentes independientes —probabilidad,
  calidad de los datos, volatilidad propia del mercado, contexto de copa, tamaño de muestra,
  discrepancia con el mercado— y se traduce a las cinco etiquetas fijas. `MUY_BAJO` exige
  probabilidad ≥ 0,80 **y** calidad ≥ 70: una cuota corta nunca basta.
- **Confianza** (§13–§14): mide la solidez de la estimación, no lo probable que sea el acierto.
  Es independiente del riesgo.
- **Selección** (§19): se puntúan a la vez probabilidad, EV, confianza y riesgo. El mercado más
  probable no gana por serlo. La alternativa se busca en un grupo distinto para que no sea la
  misma apuesta disfrazada.

### Reglas heredadas de la auditoría de agosto de 2026

Están marcadas como tales en el código:

- Una desviación mayor de **0,20** frente a la probabilidad implícita de la cuota descarta el
  mercado como pronóstico: a esa distancia el equivocado suele ser el modelo, no la casa.
- El umbral de doble oportunidad es **0,70**, no 0,75.
- El marcador exacto es orientativo y no se usa como argumento para BTTS ni Over/Under.
- Sin cuota anotada no hay EV, ROI ni CLV: la interfaz insiste en registrarla.

## Archivos

```
sistema-futbol/
├── PROMPT_MAESTRO.md   Prompt de instrucciones base
├── index.html          Interfaz principal
├── css/styles.css      Sistema de diseño
└── js/
    ├── modelo.js       Poisson bivariado + Dixon-Coles, derivación de mercados
    ├── reglas.js       EV, riesgo, confianza, selección y cálculos probabilísticos
    └── app.js          Control de la interfaz y renderizado
```

Sin dependencias ni compilación: JavaScript de navegador y tres archivos estáticos.

## Aviso

El sistema produce estimaciones probabilísticas, nunca certezas. Un EV positivo sólo indica una
diferencia favorable entre la probabilidad estimada y la cuota utilizada; no es un resultado
asegurado.
