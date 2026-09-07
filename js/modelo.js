/* ============================================================
   sistema-futbol — Motor probabilístico
   ------------------------------------------------------------
   Poisson bivariado con corrección Dixon-Coles para marcadores bajos.
   Todo lo que sale de aquí es número decimal (0–1) o null: nunca strings,
   nunca porcentajes (§3, §5 del prompt maestro).

   R1 — no inventar datos: este módulo NO rellena huecos. Si faltan los goles
   a favor/en contra de alguno de los dos equipos, devuelve null y el resto
   del sistema publica el análisis con los campos numéricos en null.
   ============================================================ */

(function (global) {
  'use strict';

  // --- Constantes del modelo (parámetros, no datos del partido) ---
  const RHO = -0.05;        // Dixon-Coles: dependencia en marcadores 0-0, 1-0, 0-1, 1-1
  const MAX_GOLES = 10;     // truncamiento de la matriz de marcadores
  const AJUSTE_MAX = 0.30;  // §16: ningún conjunto de factores mueve lambda más de un 30 %
  const LAMBDA_MIN = 0.15;
  const LAMBDA_MAX = 5.00;

  const esNum = v => typeof v === 'number' && isFinite(v);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const r4 = v => (esNum(v) ? Math.round(v * 10000) / 10000 : null);

  const FACT = (function () {
    const f = [1];
    for (let i = 1; i <= MAX_GOLES + 1; i++) f[i] = f[i - 1] * i;
    return f;
  })();

  const poisson = (k, lambda) => Math.exp(-lambda) * Math.pow(lambda, k) / FACT[k];

  // Corrección Dixon-Coles: reparte masa entre los cuatro marcadores bajos,
  // donde el Poisson independiente subestima empates y resultados mínimos.
  function tau(i, j, lh, la, rho) {
    if (i === 0 && j === 0) return 1 - lh * la * rho;
    if (i === 0 && j === 1) return 1 + lh * rho;
    if (i === 1 && j === 0) return 1 + la * rho;
    if (i === 1 && j === 1) return 1 - rho;
    return 1;
  }

  /* ------------------------------------------------------------
     Redondeo con cuadre: redondea a 4 decimales y devuelve el residuo
     al elemento mayor, de modo que la suma sea exactamente 1 (§6).
     ------------------------------------------------------------ */
  function cuadrar(valores) {
    const red = valores.map(v => Math.round(v * 10000) / 10000);
    const suma = red.reduce((s, v) => s + v, 0);
    const dif = Math.round((1 - suma) * 10000) / 10000;
    if (dif !== 0) {
      let idx = 0;
      for (let i = 1; i < red.length; i++) if (red[i] > red[idx]) idx = i;
      red[idx] = Math.round((red[idx] + dif) * 10000) / 10000;
    }
    return red;
  }

  /* ------------------------------------------------------------
     Fuerzas ofensivas/defensivas y lambdas esperados.
     entrada.local / entrada.visitante: { pj, gf, gc, forma, bajas, descanso }
     gf/gc son goles POR PARTIDO (en casa y fuera respectivamente, salvo que
     entrada.liga.datosGlobales sea true).
     ------------------------------------------------------------ */
  function calcularLambdas(entrada) {
    const liga = entrada.liga || {};
    const L = entrada.local || {};
    const V = entrada.visitante || {};

    if (!esNum(liga.golesPorPartido) || liga.golesPorPartido <= 0) return null;
    if (!esNum(L.gf) || !esNum(L.gc) || !esNum(V.gf) || !esNum(V.gc)) return null;

    const mediaEquipo = liga.golesPorPartido / 2;

    const ataqueLocal     = L.gf / mediaEquipo;
    const defensaLocal    = L.gc / mediaEquipo;
    const ataqueVisitante = V.gf / mediaEquipo;
    const defensaVisitante = V.gc / mediaEquipo;

    let baseLocal     = ataqueLocal * defensaVisitante * mediaEquipo;
    let baseVisitante = ataqueVisitante * defensaLocal * mediaEquipo;

    // La ventaja de localía sólo se aplica cuando los promedios introducidos
    // son globales; si son de casa/fuera, la localía ya está dentro del dato.
    const aplicaLocalia = liga.datosGlobales === true && esNum(liga.ventajaLocal) && liga.ventajaLocal > 0;
    if (aplicaLocalia) {
      baseLocal *= liga.ventajaLocal;
      baseVisitante /= liga.ventajaLocal;
    }

    const ajustes = [];
    let factorLocal = 1;
    let factorVisitante = 1;

    // Forma reciente: puntos de los últimos 5 partidos (0–15).
    // Efecto acotado: ±12 % sobre el propio ataque, ±8 % sobre el ataque rival.
    if (esNum(L.forma)) {
      const d = clamp(L.forma, 0, 15) / 15 - 0.5;
      factorLocal *= 1 + 0.24 * d;
      factorVisitante *= 1 - 0.16 * d;
      ajustes.push({ clave: 'FORMA_LOCAL', valor: d });
    }
    if (esNum(V.forma)) {
      const d = clamp(V.forma, 0, 15) / 15 - 0.5;
      factorVisitante *= 1 + 0.24 * d;
      factorLocal *= 1 - 0.16 * d;
      ajustes.push({ clave: 'FORMA_VISITANTE', valor: d });
    }

    // Bajas relevantes en escala 0–5 (lesiones + sanciones declaradas).
    if (esNum(L.bajas) && L.bajas > 0) {
      const b = clamp(L.bajas, 0, 5);
      factorLocal *= 1 - 0.035 * b;
      factorVisitante *= 1 + 0.025 * b;
      ajustes.push({ clave: 'BAJAS_LOCAL', valor: b });
    }
    if (esNum(V.bajas) && V.bajas > 0) {
      const b = clamp(V.bajas, 0, 5);
      factorVisitante *= 1 - 0.035 * b;
      factorLocal *= 1 + 0.025 * b;
      ajustes.push({ clave: 'BAJAS_VISITANTE', valor: b });
    }

    // Fatiga: diferencia de días de descanso, tope ±4 días, ±1,5 % por día.
    if (esNum(L.descanso) && esNum(V.descanso)) {
      const d = clamp(L.descanso - V.descanso, -4, 4);
      if (d !== 0) {
        factorLocal *= 1 + 0.015 * d;
        factorVisitante *= 1 - 0.015 * d;
        ajustes.push({ clave: 'DESCANSO', valor: d });
      }
    }

    // §16: ningún factor domina. El ajuste acumulado se recorta a ±30 %.
    const recorteLocal = clamp(factorLocal, 1 - AJUSTE_MAX, 1 + AJUSTE_MAX);
    const recorteVisitante = clamp(factorVisitante, 1 - AJUSTE_MAX, 1 + AJUSTE_MAX);
    const recortado = recorteLocal !== factorLocal || recorteVisitante !== factorVisitante;

    return {
      lambdaLocal: clamp(baseLocal * recorteLocal, LAMBDA_MIN, LAMBDA_MAX),
      lambdaVisitante: clamp(baseVisitante * recorteVisitante, LAMBDA_MIN, LAMBDA_MAX),
      base: { local: baseLocal, visitante: baseVisitante },
      factores: { local: recorteLocal, visitante: recorteVisitante, recortado: recortado },
      fuerzas: {
        ataqueLocal: ataqueLocal,
        defensaLocal: defensaLocal,
        ataqueVisitante: ataqueVisitante,
        defensaVisitante: defensaVisitante
      },
      mediaEquipo: mediaEquipo,
      localiaAplicada: aplicaLocalia,
      ajustes: ajustes
    };
  }

  /* ------------------------------------------------------------
     Matriz conjunta de marcadores, normalizada a suma 1.
     ------------------------------------------------------------ */
  function matrizMarcadores(lh, la) {
    const m = [];
    let total = 0;
    for (let i = 0; i <= MAX_GOLES; i++) {
      m[i] = [];
      for (let j = 0; j <= MAX_GOLES; j++) {
        const p = poisson(i, lh) * poisson(j, la) * tau(i, j, lh, la, RHO);
        m[i][j] = p;
        total += p;
      }
    }
    for (let i = 0; i <= MAX_GOLES; i++) {
      for (let j = 0; j <= MAX_GOLES; j++) m[i][j] /= total;
    }
    return m;
  }

  /* ------------------------------------------------------------
     Derivación de todos los mercados a partir de la matriz.
     Los complementos (under, BTTS_NO) se calculan como 1 - over redondeado
     para que la suma dé exactamente 1 y el validador no encuentre residuos.
     ------------------------------------------------------------ */
  function derivar(m) {
    let ph = 0, pe = 0, pv = 0, btts = 0;
    const totales = new Array(2 * MAX_GOLES + 1).fill(0);
    const golesLocal = new Array(MAX_GOLES + 1).fill(0);
    const golesVisitante = new Array(MAX_GOLES + 1).fill(0);
    const marcadores = [];
    const empates = [];

    for (let i = 0; i <= MAX_GOLES; i++) {
      for (let j = 0; j <= MAX_GOLES; j++) {
        const p = m[i][j];
        if (i > j) ph += p; else if (i === j) { pe += p; empates.push({ score: i + '-' + j, probability: p }); } else pv += p;
        totales[i + j] += p;
        golesLocal[i] += p;
        golesVisitante[j] += p;
        if (i >= 1 && j >= 1) btts += p;
        marcadores.push({ score: i + '-' + j, probability: p });
      }
    }

    const terna = cuadrar([ph, pe, pv]);

    const over0_5 = r4(1 - totales[0]);
    const over1_5 = r4(1 - totales[0] - totales[1]);
    const over2_5 = r4(1 - totales[0] - totales[1] - totales[2]);
    const over3_5 = r4(1 - totales[0] - totales[1] - totales[2] - totales[3]);

    const bttsSi = r4(btts);
    const localOver0_5 = r4(1 - golesLocal[0]);
    const visitanteOver0_5 = r4(1 - golesVisitante[0]);

    marcadores.sort((a, b) => b.probability - a.probability);
    empates.sort((a, b) => b.probability - a.probability);

    return {
      probabilities: {
        homeWin: terna[0],
        draw: terna[1],
        awayWin: terna[2]
      },
      goals: {
        over0_5: over0_5,
        over1_5: over1_5,
        over2_5: over2_5,
        over3_5: over3_5,
        under1_5: r4(1 - over1_5),
        under2_5: r4(1 - over2_5),
        under3_5: r4(1 - over3_5)
      },
      bothTeamsToScore: {
        yes: bttsSi,
        no: r4(1 - bttsSi)
      },
      teamGoals: {
        homeOver0_5: localOver0_5,
        homeOver1_5: r4(1 - golesLocal[0] - golesLocal[1]),
        awayOver0_5: visitanteOver0_5,
        awayOver1_5: r4(1 - golesVisitante[0] - golesVisitante[1])
      },
      mostLikelyScores: marcadores.slice(0, 3).map(s => ({
        score: s.score,
        probability: r4(s.probability)
      })),
      // Empate más probable: se usa para describir el escenario equilibrado
      // sin apoyarse en marcadores que no son empate.
      empateMasProbable: empates.length
        ? { score: empates[0].score, probability: r4(empates[0].probability) }
        : null,
      golesEsperados: {
        local: r4(golesLocal.reduce((s, p, i) => s + p * i, 0)),
        visitante: r4(golesVisitante.reduce((s, p, i) => s + p * i, 0)),
        total: r4(totales.reduce((s, p, i) => s + p * i, 0))
      }
    };
  }

  /* ------------------------------------------------------------
     Punto de entrada del motor: entrada -> distribución completa.
     Devuelve null cuando no hay datos suficientes (R1).
     ------------------------------------------------------------ */
  function calcular(entrada) {
    const lambdas = calcularLambdas(entrada);
    if (!lambdas) return null;
    const matriz = matrizMarcadores(lambdas.lambdaLocal, lambdas.lambdaVisitante);
    const derivado = derivar(matriz);
    derivado.lambdas = lambdas;
    return derivado;
  }

  global.SFModelo = {
    RHO: RHO,
    MAX_GOLES: MAX_GOLES,
    AJUSTE_MAX: AJUSTE_MAX,
    esNum: esNum,
    clamp: clamp,
    r4: r4,
    cuadrar: cuadrar,
    poisson: poisson,
    calcularLambdas: calcularLambdas,
    matrizMarcadores: matrizMarcadores,
    derivar: derivar,
    calcular: calcular
  };
})(window);
