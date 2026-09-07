/* ============================================================
   sistema-futbol — Reglas de riesgo, valor y selección
   ------------------------------------------------------------
   Convierte la distribución del motor en el JSON del prompt maestro:
   catálogo de mercados (§15, §27), EV (§9), riesgo (§11–§12),
   confianza (§13–§14), selección del pronóstico (§19–§22),
   factores clave (§29), calidad de datos (§28) y conclusión (§30).

   Dos reglas vienen de la auditoría de agosto de 2026 y están marcadas
   como tales en el código:
     · desviación > 0,20 frente a la probabilidad implícita = el modelo se
       equivoca, no la casa → el mercado queda descartado como principal;
     · el umbral de doble oportunidad es 0,70, no 0,75.
   ============================================================ */

(function (global) {
  'use strict';

  const M = global.SFModelo;
  const esNum = M.esNum;
  const clamp = M.clamp;
  const r4 = M.r4;

  const NIVELES_RIESGO = ['MUY_BAJO', 'BAJO', 'MEDIO', 'ALTO', 'MUY_ALTO'];

  // Auditoría agosto 2026.
  const DESVIACION_SOSPECHOSA = 0.20;
  const UMBRAL_DOBLE_OPORTUNIDAD = 0.70;

  // Banda muerta del EV para no etiquetar como valor el ruido de redondeo.
  const BANDA_EV_NEUTRAL = 0.01;

  /* --- Catálogo único de mercados (§15, §27) ---------------------------
     `vol` es la volatilidad intrínseca del mercado, no su probabilidad:
     cuánto depende el resultado de sucesos difíciles de predecir. */
  const MERCADOS = [
    { id: 'LOCAL',      nombre: 'Gana el local',     grupo: 'RESULTADO', vol: 6,  p: d => d.probabilities.homeWin },
    { id: 'EMPATE',     nombre: 'Empate',            grupo: 'RESULTADO', vol: 12, p: d => d.probabilities.draw },
    { id: 'VISITANTE',  nombre: 'Gana el visitante', grupo: 'RESULTADO', vol: 6,  p: d => d.probabilities.awayWin },

    { id: 'DOBLE_1X', nombre: 'Doble oportunidad 1X', grupo: 'DOBLE', vol: 3, p: d => r4(1 - d.probabilities.awayWin) },
    { id: 'DOBLE_X2', nombre: 'Doble oportunidad X2', grupo: 'DOBLE', vol: 3, p: d => r4(1 - d.probabilities.homeWin) },
    { id: 'DOBLE_12', nombre: 'Doble oportunidad 12', grupo: 'DOBLE', vol: 4, p: d => r4(1 - d.probabilities.draw) },

    { id: 'OVER_0_5',  nombre: 'Over 0.5 goles',  grupo: 'GOLES', vol: 4,  p: d => d.goals.over0_5 },
    { id: 'OVER_1_5',  nombre: 'Over 1.5 goles',  grupo: 'GOLES', vol: 6,  p: d => d.goals.over1_5 },
    { id: 'OVER_2_5',  nombre: 'Over 2.5 goles',  grupo: 'GOLES', vol: 9,  p: d => d.goals.over2_5 },
    { id: 'OVER_3_5',  nombre: 'Over 3.5 goles',  grupo: 'GOLES', vol: 15, p: d => d.goals.over3_5 },
    { id: 'UNDER_1_5', nombre: 'Under 1.5 goles', grupo: 'GOLES', vol: 12, p: d => d.goals.under1_5 },
    { id: 'UNDER_2_5', nombre: 'Under 2.5 goles', grupo: 'GOLES', vol: 9,  p: d => d.goals.under2_5 },
    { id: 'UNDER_3_5', nombre: 'Under 3.5 goles', grupo: 'GOLES', vol: 5,  p: d => d.goals.under3_5 },

    { id: 'BTTS_SI', nombre: 'Ambos equipos marcan',    grupo: 'BTTS', vol: 8, p: d => d.bothTeamsToScore.yes },
    { id: 'BTTS_NO', nombre: 'Ambos equipos no marcan', grupo: 'BTTS', vol: 8, p: d => d.bothTeamsToScore.no },

    { id: 'LOCAL_OVER_0_5', nombre: 'El local marca +0.5', grupo: 'EQUIPO_LOCAL', vol: 5,  p: d => d.teamGoals.homeOver0_5 },
    { id: 'LOCAL_OVER_1_5', nombre: 'El local marca +1.5', grupo: 'EQUIPO_LOCAL', vol: 14, p: d => d.teamGoals.homeOver1_5 },

    { id: 'VISITANTE_OVER_0_5', nombre: 'El visitante marca +0.5', grupo: 'EQUIPO_VISITANTE', vol: 5,  p: d => d.teamGoals.awayOver0_5 },
    { id: 'VISITANTE_OVER_1_5', nombre: 'El visitante marca +1.5', grupo: 'EQUIPO_VISITANTE', vol: 14, p: d => d.teamGoals.awayOver1_5 }
  ];

  const MERCADOS_POR_ID = MERCADOS.reduce((acc, m) => { acc[m.id] = m; return acc; }, {});
  const IDS_MERCADO = MERCADOS.map(m => m.id);

  /* --- Aritmética de cuotas (§7, §8, §9, §26) --- */
  const probabilidadImplicita = odds => (esNum(odds) && odds > 1 ? r4(1 / odds) : null);
  const valorEsperado = (p, odds) => (esNum(p) && esNum(odds) && odds > 1 ? r4(p * odds - 1) : null);

  function etiquetaValor(ev) {
    if (!esNum(ev)) return '';
    if (ev > BANDA_EV_NEUTRAL) return 'POSITIVE';
    if (ev < -BANDA_EV_NEUTRAL) return 'NEGATIVE';
    return 'NEUTRAL';
  }

  /* --- Riesgo (§11, §12, §14) ---------------------------------------
     Se acumula incertidumbre desde fuentes independientes y se traduce a
     una de las cinco etiquetas fijas. La probabilidad pesa, pero no decide
     sola: una cuota corta nunca basta para MUY_BAJO. */
  function evaluarRiesgo(p, vol, ctx, desviacionAlta) {
    if (!esNum(p)) return { risk: '', indice: null };

    let inc = (1 - p) * 45;
    inc += ((100 - ctx.calidad) / 100) * 25;
    inc += vol;
    if (ctx.esCopa) inc += 8;
    if (esNum(ctx.muestraMinima) && ctx.muestraMinima < 6) inc += 8;
    if (ctx.muestraMinima === null) inc += 5;
    if (desviacionAlta) inc += 12;

    let idx = inc < 18 ? 0 : inc < 32 ? 1 : inc < 50 ? 2 : inc < 68 ? 3 : 4;

    // §12: MUY_BAJO exige probabilidad muy alta Y evidencia sólida.
    if (idx === 0 && (p < 0.80 || ctx.calidad < 70)) idx = 1;
    // Por debajo del 50 % nunca puede considerarse riesgo bajo.
    if (p < 0.50 && idx < 2) idx = 2;

    return { risk: NIVELES_RIESGO[idx], indice: idx };
  }

  /* --- Confianza (§13, §14) ------------------------------------------
     Mide la solidez de la estimación, no lo probable que sea el acierto.
     Penaliza fuerte la discrepancia con el mercado (auditoría agosto 2026). */
  function evaluarConfianza(p, implicita, ctx) {
    if (!esNum(p)) return null;

    let c = 50;
    c += (ctx.calidad - 50) * 0.45;
    if (esNum(ctx.muestraMinima)) c += (Math.min(ctx.muestraMinima, 20) / 20) * 12 - 6;
    else c -= 6;
    if (esNum(implicita)) c += 6 - Math.min(Math.abs(p - implicita), 0.30) * 60;
    if (ctx.esCopa) c -= 6;
    c += (p - 0.5) * 20;

    return Math.round(clamp(c, 0, 100));
  }

  /* --- Construcción del array markets (§26) --- */
  function construirMercados(dist, cuotas, ctx) {
    cuotas = cuotas || {};
    return MERCADOS.map(function (def) {
      const p = dist ? def.p(dist) : null;
      const odds = esNum(cuotas[def.id]) && cuotas[def.id] > 1 ? cuotas[def.id] : null;
      const implicita = probabilidadImplicita(odds);
      const ev = valorEsperado(p, odds);
      const desviacion = esNum(p) && esNum(implicita) ? r4(p - implicita) : null;
      const desviacionAlta = esNum(desviacion) && Math.abs(desviacion) > DESVIACION_SOSPECHOSA;
      const riesgo = evaluarRiesgo(p, def.vol, ctx, desviacionAlta);

      return {
        market: def.id,
        nombre: def.nombre,
        grupo: def.grupo,
        probability: esNum(p) ? p : null,
        odds: odds,
        impliedProbability: implicita,
        ev: ev,
        risk: riesgo.risk,
        confidence: evaluarConfianza(p, implicita, ctx),
        value: etiquetaValor(ev),
        desviacion: desviacion,
        desviacionAlta: desviacionAlta,
        indiceRiesgo: riesgo.indice
      };
    });
  }

  // Vista limpia para el JSON: sólo los campos que exige §26.
  function limpiarMercado(m) {
    return {
      market: m.market,
      probability: m.probability,
      odds: m.odds,
      impliedProbability: m.impliedProbability,
      ev: m.ev,
      risk: m.risk,
      confidence: m.confidence,
      value: m.value
    };
  }

  /* --- Selección del pronóstico principal (§19) ------------------------
     Nunca es "el de mayor probabilidad": se puntúa probabilidad, valor,
     confianza y riesgo a la vez, después de descartar los mercados que
     incumplen las reglas duras. */
  function puntuar(m, hayCuotas) {
    const pn = clamp((m.probability - 0.50) / 0.45, 0, 1);
    let evn;
    if (esNum(m.ev)) evn = clamp((m.ev + 0.05) / 0.30, 0, 1);
    else evn = hayCuotas ? 0.30 : 0.50; // sin cuota se penaliza, pero no se excluye
    const cn = esNum(m.confidence) ? m.confidence / 100 : 0.5;
    const rn = m.indiceRiesgo === null ? 0.5 : 1 - m.indiceRiesgo / 4;
    return r4(0.35 * pn + 0.30 * evn + 0.20 * cn + 0.15 * rn);
  }

  function seleccionar(mercados, ctx) {
    const conProb = mercados.filter(m => esNum(m.probability));
    if (!conProb.length) return { principal: null, alternativa: null, evitar: null, hayCuotas: false };

    const hayCuotas = conProb.some(m => esNum(m.odds));

    const elegibles = conProb.filter(function (m) {
      if (m.probability < 0.50) return false;
      if (m.grupo === 'DOBLE' && m.probability < UMBRAL_DOBLE_OPORTUNIDAD) return false;
      if (m.desviacionAlta) return false;              // auditoría agosto 2026
      if (esNum(m.ev) && m.ev < 0) return false;       // sin valor, no se propone
      if (m.indiceRiesgo === 4) return false;          // MUY_ALTO nunca como pronóstico
      return true;
    });

    const candidatos = (elegibles.length ? elegibles : conProb.filter(m => m.probability >= 0.50))
      .map(m => ({ m: m, score: puntuar(m, hayCuotas) }))
      .sort((a, b) => b.score - a.score);

    const principal = candidatos.length ? candidatos[0].m : null;

    // La alternativa debe venir de otro grupo: dos apuestas correlacionadas
    // (por ejemplo LOCAL y DOBLE_1X) no son dos pronósticos, son uno.
    let alternativa = null;
    if (principal) {
      const otro = candidatos.find(c => c.m.grupo !== principal.grupo);
      alternativa = otro ? otro.m : (candidatos[1] ? candidatos[1].m : null);
    }

    // Mercado a evitar (§22): el que más atractivo parece entre los que
    // tienen mala relación riesgo/valor.
    const sospechosos = conProb.filter(function (m) {
      if (m === principal || m === alternativa) return false;
      return (esNum(m.ev) && m.ev < -0.05) ||
             m.desviacionAlta ||
             (m.indiceRiesgo >= 3 && m.probability < 0.55);
    });

    let evitar = null;
    if (sospechosos.length) {
      evitar = sospechosos.slice().sort(function (a, b) {
        const atractivo = m => m.probability + (esNum(m.odds) ? clamp((m.odds - 1.5) / 10, 0, 0.25) : 0);
        return atractivo(b) - atractivo(a);
      })[0];
    } else {
      const volatiles = conProb
        .filter(m => m !== principal && m !== alternativa && m.indiceRiesgo >= 3)
        .sort((a, b) => b.probability - a.probability);
      evitar = volatiles.length ? volatiles[0] : null;
    }

    return { principal: principal, alternativa: alternativa, evitar: evitar, hayCuotas: hayCuotas };
  }

  /* --- Calidad de los datos (§28) ------------------------------------
     Mide disponibilidad y solidez de la información, no la probabilidad
     de acertar. */
  function calcularCalidad(entrada, dist) {
    const L = entrada.local || {};
    const V = entrada.visitante || {};
    const liga = entrada.liga || {};
    const cuotas = entrada.cuotas || {};

    let score = 0;
    const faltan = [];

    if (esNum(L.gf) && esNum(L.gc)) score += 20; else faltan.push('goles a favor y en contra del local');
    if (esNum(V.gf) && esNum(V.gc)) score += 20; else faltan.push('goles a favor y en contra del visitante');

    if (esNum(L.pj)) score += (Math.min(L.pj, 10) / 10) * 10; else faltan.push('tamaño de muestra del local');
    if (esNum(V.pj)) score += (Math.min(V.pj, 10) / 10) * 10; else faltan.push('tamaño de muestra del visitante');

    if (esNum(L.forma)) score += 7; else faltan.push('forma reciente del local');
    if (esNum(V.forma)) score += 7; else faltan.push('forma reciente del visitante');

    const nCuotas = IDS_MERCADO.filter(id => esNum(cuotas[id]) && cuotas[id] > 1).length;
    if (nCuotas > 0) score += Math.min(nCuotas / 6, 1) * 12;
    else faltan.push('cuotas de la casa de apuestas');

    if (liga.mediaProvista === true) score += 8;
    else faltan.push('media de goles real de la competición (se usó el valor de referencia del formulario)');

    const contextoInformado = [L.bajas, V.bajas, L.descanso, V.descanso].filter(esNum).length;
    score += (contextoInformado / 4) * 6;
    if (contextoInformado < 4) faltan.push('bajas y días de descanso completos');

    if (!dist) score = Math.min(score, 35);

    let comment;
    if (!dist) {
      comment = 'Faltan los goles a favor y en contra de ambos equipos, que son el mínimo necesario para estimar el modelo. No se generan probabilidades.';
    } else if (!faltan.length) {
      comment = 'Datos completos: goles, muestra, forma, contexto y cuotas disponibles para los dos equipos.';
    } else {
      comment = 'Información introducida por el usuario. Pendiente de completar: ' + faltan.join('; ') + '.';
    }

    return { score: Math.round(clamp(score, 0, 100)), comment: comment, faltan: faltan };
  }

  /* --- Texto ---------------------------------------------------------- */
  const n2 = v => (esNum(v) ? v.toFixed(2).replace('.', ',') : '');
  const n0 = v => (esNum(v) ? String(Math.round(v)) : '');
  const nombreDe = id => (MERCADOS_POR_ID[id] ? MERCADOS_POR_ID[id].nombre : id);

  function construirFactores(entrada, dist, seleccion) {
    const factores = [];
    if (!dist) return factores;

    const L = entrada.local || {};
    const V = entrada.visitante || {};
    const nombreL = entrada.partido.local || 'El local';
    const nombreV = entrada.partido.visitante || 'El visitante';
    const lam = dist.lambdas;

    factores.push(nombreL + ' promedia ' + n2(L.gf) + ' goles a favor y ' + n2(L.gc) +
      ' en contra por partido' + (esNum(L.pj) ? ' sobre una muestra de ' + n0(L.pj) + ' encuentros.' : '.'));
    factores.push(nombreV + ' promedia ' + n2(V.gf) + ' goles a favor y ' + n2(V.gc) +
      ' en contra por partido' + (esNum(V.pj) ? ' sobre una muestra de ' + n0(V.pj) + ' encuentros.' : '.'));
    factores.push('El modelo proyecta ' + n2(lam.lambdaLocal) + ' goles esperados para el local y ' +
      n2(lam.lambdaVisitante) + ' para el visitante, con un total de ' + n2(dist.golesEsperados.total) + '.');

    if (esNum(L.forma) && esNum(V.forma)) {
      const dif = L.forma - V.forma;
      if (Math.abs(dif) >= 3) {
        factores.push('La forma reciente favorece a ' + (dif > 0 ? nombreL : nombreV) +
          ' por ' + n0(Math.abs(dif)) + ' puntos de diferencia en los últimos cinco partidos.');
      } else {
        factores.push('La forma reciente es equivalente entre ambos equipos, con una diferencia de ' +
          n0(Math.abs(dif)) + ' puntos en los últimos cinco partidos.');
      }
    }

    if (esNum(L.bajas) && L.bajas > 0) factores.push('El local afronta el partido con bajas declaradas de impacto ' + n0(L.bajas) + ' sobre 5.');
    if (esNum(V.bajas) && V.bajas > 0) factores.push('El visitante afronta el partido con bajas declaradas de impacto ' + n0(V.bajas) + ' sobre 5.');

    if (esNum(L.descanso) && esNum(V.descanso) && L.descanso !== V.descanso) {
      factores.push('Diferencia de descanso de ' + n0(Math.abs(L.descanso - V.descanso)) + ' días a favor de ' +
        (L.descanso > V.descanso ? nombreL : nombreV) + '.');
    }

    if (entrada.partido.tipo === 'COPA') {
      factores.push('Partido de copa: la auditoría de agosto de 2026 mostró que este contexto aumenta la varianza y penaliza la fiabilidad del modelo.');
    }

    if (lam.factores.recortado) {
      factores.push('Los ajustes de contexto se recortaron al máximo permitido para que ningún factor aislado domine la estimación.');
    }

    const desviados = seleccion.desviados || [];
    if (desviados.length) {
      factores.push('El modelo se separa más de 0,20 de la probabilidad implícita en ' + n0(desviados.length) +
        ' mercados (' + desviados.join(', ') + '); esos mercados quedan descartados como pronóstico.');
    }

    return factores;
  }

  function justificar(m, ctx, esPrincipal) {
    if (!m) return '';
    const partes = [];
    partes.push(nombreDe(m.market) + ' con probabilidad estimada de ' + n2(m.probability) + '.');

    if (esNum(m.odds)) {
      partes.push('La cuota de ' + n2(m.odds) + ' implica ' + n2(m.impliedProbability) +
        ', de modo que el valor esperado es ' + n2(m.ev) + '.');
    } else {
      partes.push('No se registró cuota, por lo que no puede calcularse el valor esperado.');
    }

    partes.push('Riesgo ' + m.risk.toLowerCase().replace('_', ' ') + ' y confianza ' + n0(m.confidence) +
      ' sobre 100, con una calidad de datos de ' + n0(ctx.calidad) + '.');

    if (esPrincipal) {
      partes.push('Se selecciona combinando probabilidad, riesgo, confianza y valor, no por ser el mercado más probable.');
    } else {
      partes.push('Se propone como cobertura de un grupo de mercados distinto al principal, para no duplicar la misma apuesta.');
    }
    return partes.join(' ');
  }

  function razonEvitar(m, ctx) {
    if (!m) return '';
    const partes = [nombreDe(m.market) + ' aparenta interés con una probabilidad de ' + n2(m.probability) + ', pero no compensa.'];
    if (m.desviacionAlta) {
      partes.push('La estimación se aleja ' + n2(Math.abs(m.desviacion)) +
        ' de la probabilidad implícita de la cuota; una diferencia de esa magnitud suele indicar un error del modelo antes que un error del mercado.');
    }
    if (esNum(m.ev) && m.ev < 0) {
      partes.push('El valor esperado con la cuota disponible es ' + n2(m.ev) + '.');
    }
    if (m.indiceRiesgo >= 3) {
      partes.push('Además es un mercado de riesgo ' + m.risk.toLowerCase().replace('_', ' ') +
        ', muy dependiente de sucesos puntuales.');
    }
    if (ctx.esCopa) partes.push('El contexto de copa amplía todavía más la dispersión de resultados.');
    return partes.join(' ');
  }

  function construirEscenarios(dist, entrada) {
    const base = [
      { id: 'ESCENARIO_LOCAL', probability: null, description: '' },
      { id: 'ESCENARIO_EQUILIBRADO', probability: null, description: '' },
      { id: 'ESCENARIO_VISITANTE', probability: null, description: '' }
    ];
    if (!dist) return base;

    const nombreL = entrada.partido.local || 'el local';
    const nombreV = entrada.partido.visitante || 'el visitante';
    const p = dist.probabilities;

    base[0].probability = p.homeWin;
    base[0].description = 'El partido se rompe a favor de ' + nombreL +
      ', que impone su producción ofensiva de ' + n2(dist.lambdas.lambdaLocal) +
      ' goles esperados frente a la defensa visitante.';

    base[1].probability = p.draw;
    base[1].description = 'Encuentro cerrado y reparto de puntos, con una diferencia de goles esperados de ' +
      n2(Math.abs(dist.lambdas.lambdaLocal - dist.lambdas.lambdaVisitante)) + ' entre los dos equipos.' +
      (dist.empateMasProbable ? ' El empate más probable dentro de este escenario es el ' +
        dist.empateMasProbable.score + '.' : '');

    base[2].probability = p.awayWin;
    base[2].description = nombreV + ' aprovecha fuera de casa su registro ofensivo de ' +
      n2(dist.lambdas.lambdaVisitante) + ' goles esperados y se lleva el partido.';

    return base;
  }

  function construirConclusion(dist, entrada, seleccion, calidad) {
    if (!dist) {
      return 'No hay datos suficientes para estimar el partido. Se requieren, como mínimo, los goles a favor y en contra por partido de ambos equipos. Todos los campos numéricos quedan en null para no publicar valores inventados.';
    }
    const nombreL = entrada.partido.local || 'el local';
    const nombreV = entrada.partido.visitante || 'el visitante';
    const p = dist.probabilities;

    let favorito;
    if (p.homeWin > p.awayWin + 0.08) favorito = nombreL + ' parte como favorito';
    else if (p.awayWin > p.homeWin + 0.08) favorito = nombreV + ' parte como favorito';
    else favorito = 'el partido se presenta equilibrado en el resultado';

    const partes = [];
    partes.push('Con los datos aportados, ' + favorito + ', con un total esperado de ' +
      n2(dist.golesEsperados.total) + ' goles.');

    if (seleccion.principal) {
      partes.push('La mejor relación entre probabilidad, riesgo y valor la ofrece el mercado ' +
        nombreDe(seleccion.principal.market) + ', con riesgo ' +
        seleccion.principal.risk.toLowerCase().replace('_', ' ') + '.');
    } else {
      partes.push('Ningún mercado alcanza el umbral mínimo de probabilidad, valor y riesgo para proponerse como pronóstico.');
    }

    if (seleccion.evitar) {
      partes.push('Conviene descartar el mercado ' + nombreDe(seleccion.evitar.market) + '.');
    }

    partes.push('La calidad de los datos es de ' + n0(calidad.score) +
      ' sobre 100, y el análisis es una estimación probabilística, no una certeza.');

    return partes.join(' ');
  }

  /* --- Ensamblado final del JSON (§25) --- */
  function analizar(entrada) {
    entrada = entrada || {};
    entrada.partido = entrada.partido || {};

    const dist = M.calcular(entrada);
    const calidad = calcularCalidad(entrada, dist);

    const pjs = [entrada.local && entrada.local.pj, entrada.visitante && entrada.visitante.pj].filter(esNum);
    const ctx = {
      calidad: calidad.score,
      muestraMinima: pjs.length === 2 ? Math.min(pjs[0], pjs[1]) : (pjs.length === 1 ? pjs[0] : null),
      esCopa: entrada.partido.tipo === 'COPA'
    };

    const mercados = dist ? construirMercados(dist, entrada.cuotas, ctx) : [];
    const seleccion = seleccionar(mercados, ctx);
    seleccion.desviados = mercados.filter(m => m.desviacionAlta).map(m => m.market);

    const vacio = {
      market: '', probability: null, odds: null, impliedProbability: null,
      ev: null, risk: '', confidence: null, justification: ''
    };

    const prediccion = (m, esPrincipal) => (m ? {
      market: m.market,
      probability: m.probability,
      odds: m.odds,
      impliedProbability: m.impliedProbability,
      ev: m.ev,
      risk: m.risk,
      confidence: m.confidence,
      justification: justificar(m, ctx, esPrincipal)
    } : Object.assign({}, vacio));

    const json = {
      match: {
        homeTeam: entrada.partido.local || '',
        awayTeam: entrada.partido.visitante || '',
        competition: entrada.partido.competicion || '',
        date: entrada.partido.fecha || ''
      },
      probabilities: dist ? dist.probabilities : { homeWin: null, draw: null, awayWin: null },
      goals: dist ? dist.goals : {
        over0_5: null, over1_5: null, over2_5: null, over3_5: null,
        under1_5: null, under2_5: null, under3_5: null
      },
      bothTeamsToScore: dist ? dist.bothTeamsToScore : { yes: null, no: null },
      teamGoals: dist ? dist.teamGoals : {
        homeOver0_5: null, homeOver1_5: null, awayOver0_5: null, awayOver1_5: null
      },
      markets: mercados.map(limpiarMercado),
      mostLikelyScores: dist ? dist.mostLikelyScores : [],
      scenarios: construirEscenarios(dist, entrada),
      mainPrediction: prediccion(seleccion.principal, true),
      alternativePrediction: prediccion(seleccion.alternativa, false),
      avoidMarket: {
        market: seleccion.evitar ? seleccion.evitar.market : '',
        reason: razonEvitar(seleccion.evitar, ctx)
      },
      keyFactors: construirFactores(entrada, dist, seleccion),
      dataQuality: { score: calidad.score, comment: calidad.comment },
      conclusion: construirConclusion(dist, entrada, seleccion, calidad)
    };

    return {
      json: json,
      meta: {
        distribucion: dist,
        mercados: mercados,
        seleccion: seleccion,
        contexto: ctx,
        calidad: calidad
      }
    };
  }

  global.SFReglas = {
    MERCADOS: MERCADOS,
    MERCADOS_POR_ID: MERCADOS_POR_ID,
    IDS_MERCADO: IDS_MERCADO,
    NIVELES_RIESGO: NIVELES_RIESGO,
    DESVIACION_SOSPECHOSA: DESVIACION_SOSPECHOSA,
    UMBRAL_DOBLE_OPORTUNIDAD: UMBRAL_DOBLE_OPORTUNIDAD,
    probabilidadImplicita: probabilidadImplicita,
    valorEsperado: valorEsperado,
    etiquetaValor: etiquetaValor,
    evaluarRiesgo: evaluarRiesgo,
    evaluarConfianza: evaluarConfianza,
    nombreDe: nombreDe,
    analizar: analizar
  };
})(window);
