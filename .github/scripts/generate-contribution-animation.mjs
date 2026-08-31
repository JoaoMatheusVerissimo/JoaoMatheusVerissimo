import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.GH_TOKEN;
const username = process.env.GITHUB_USERNAME;

if (!token) {
  throw new Error("GH_TOKEN não foi informado.");
}

if (!username) {
  throw new Error("GITHUB_USERNAME não foi informado.");
}

const query = `
  query ContributionCalendar($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              weekday
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "custom-contribution-animation"
  },
  body: JSON.stringify({
    query,
    variables: {
      login: username
    }
  })
});

if (!response.ok) {
  throw new Error(
    `GitHub respondeu com ${response.status}: ${await response.text()}`
  );
}

const result = await response.json();

if (result.errors) {
  throw new Error(JSON.stringify(result.errors, null, 2));
}

if (!result.data?.user) {
  throw new Error(`O usuário "${username}" não foi encontrado.`);
}

const calendar =
  result.data.user.contributionsCollection.contributionCalendar;

const weeks = calendar.weeks;
const totalContributions = calendar.totalContributions;

const width = 800;
const height = 160;
const cellSize = 10;
const gap = 4;
const step = cellSize + gap;
const gridTop = 48;
const gridLeft = Math.max(
  20,
  Math.floor((width - weeks.length * step) / 2)
);

const levelColors = {
  NONE: "#161b22",
  FIRST_QUARTILE: "#3b0a0a",
  SECOND_QUARTILE: "#6e1010",
  THIRD_QUARTILE: "#b91c1c",
  FOURTH_QUARTILE: "#ff3333"
};

const cells = new Map();

for (let x = 0; x < weeks.length; x += 1) {
  for (const day of weeks[x].contributionDays) {
    cells.set(`${x},${day.weekday}`, day);
  }
}

function isBlocked(x, y) {
  if (x < 0 || x >= weeks.length) {
    return false;
  }

  if (y < 0 || y > 6) {
    return false;
  }

  const day = cells.get(`${x},${y}`);

  // Datas fora do período do calendário também são evitadas.
  if (!day) {
    return true;
  }

  // Células com contribuições são tratadas como obstáculos.
  return day.contributionCount > 0;
}

function nodeKey(x, y) {
  return `${x},${y}`;
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function reconstructPath(cameFrom, current) {
  const path = [current];

  while (cameFrom.has(nodeKey(current.x, current.y))) {
    current = cameFrom.get(nodeKey(current.x, current.y));
    path.unshift(current);
  }

  return path;
}

function findRoute() {
  const start = {
    x: -1,
    y: 3
  };

  const goal = {
    x: weeks.length,
    y: 3
  };

  const minimumY = -1;
  const maximumY = 7;
  const minimumX = -1;
  const maximumX = weeks.length;

  const open = [start];
  const cameFrom = new Map();

  const gScore = new Map([
    [nodeKey(start.x, start.y), 0]
  ]);

  const fScore = new Map([
    [nodeKey(start.x, start.y), heuristic(start, goal)]
  ]);

  while (open.length > 0) {
    open.sort((a, b) => {
      const scoreA =
        fScore.get(nodeKey(a.x, a.y)) ?? Infinity;

      const scoreB =
        fScore.get(nodeKey(b.x, b.y)) ?? Infinity;

      return scoreA - scoreB;
    });

    const current = open.shift();

    if (
      current.x === goal.x &&
      current.y === goal.y
    ) {
      return reconstructPath(cameFrom, current);
    }

    const neighbors = [
      {
        x: current.x + 1,
        y: current.y
      },
      {
        x: current.x - 1,
        y: current.y
      },
      {
        x: current.x,
        y: current.y + 1
      },
      {
        x: current.x,
        y: current.y - 1
      }
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x < minimumX ||
        neighbor.x > maximumX ||
        neighbor.y < minimumY ||
        neighbor.y > maximumY
      ) {
        continue;
      }

      if (isBlocked(neighbor.x, neighbor.y)) {
        continue;
      }

      const currentKey = nodeKey(
        current.x,
        current.y
      );

      const neighborKey = nodeKey(
        neighbor.x,
        neighbor.y
      );

      let movementCost = 1;

      // Dá preferência ao movimento da esquerda para a direita.
      if (neighbor.x < current.x) {
        movementCost += 3;
      }

      // Evita sair da área do calendário sem necessidade.
      if (neighbor.y < 0 || neighbor.y > 6) {
        movementCost += 2;
      }

      const tentativeScore =
        (gScore.get(currentKey) ?? Infinity) +
        movementCost;

      if (
        tentativeScore <
        (gScore.get(neighborKey) ?? Infinity)
      ) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeScore);

        fScore.set(
          neighborKey,
          tentativeScore +
            heuristic(neighbor, goal)
        );

        const alreadyOpen = open.some(
          (item) =>
            item.x === neighbor.x &&
            item.y === neighbor.y
        );

        if (!alreadyOpen) {
          open.push(neighbor);
        }
      }
    }
  }

  throw new Error(
    "Não foi possível calcular uma rota para a animação."
  );
}

function pointForNode(node) {
  return {
    x:
      gridLeft +
      node.x * step +
      cellSize / 2,

    y:
      gridTop +
      node.y * step +
      cellSize / 2
  };
}

function createPathData(route) {
  return route
    .map(pointForNode)
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command} ${point.x} ${point.y}`;
    })
    .join(" ");
}

const route = findRoute();
const routePath = createPathData(route);

const squares = [];

for (let x = 0; x < weeks.length; x += 1) {
  for (const day of weeks[x].contributionDays) {
    const squareX = gridLeft + x * step;
    const squareY =
      gridTop + day.weekday * step;

    const fill =
      levelColors[day.contributionLevel] ??
      levelColors.NONE;

    const contributionLabel =
      day.contributionCount === 1
        ? "1 contribuição"
        : `${day.contributionCount} contribuições`;

    squares.push(`
      <rect
        x="${squareX}"
        y="${squareY}"
        width="${cellSize}"
        height="${cellSize}"
        rx="2"
        fill="${fill}"
      >
        <title>${day.date}: ${contributionLabel}</title>
      </rect>
    `);
  }
}

const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${width} ${height}"
  width="${width}"
  height="${height}"
  role="img"
  aria-labelledby="title description"
>
  <title id="title">
    Atividade de contribuições de ${username}
  </title>

  <desc id="description">
    Animação que percorre o calendário desviando das células com contribuições.
  </desc>

  <defs>
    <filter
      id="snakeGlow"
      x="-100%"
      y="-100%"
      width="300%"
      height="300%"
    >
      <feGaussianBlur
        stdDeviation="3"
        result="blur"
      />

      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <style>
      .route-guide {
        opacity: 0.08;
      }

      .snake {
        filter: url(#snakeGlow);
      }

      @media (prefers-reduced-motion: reduce) {
        .snake {
          display: none;
        }

        .route-guide {
          opacity: 0.25;
        }
      }
    </style>
  </defs>

  <rect
    width="${width}"
    height="${height}"
    rx="12"
    fill="#0d1117"
  />

  <text
    x="${width / 2}"
    y="25"
    text-anchor="middle"
    fill="#c9d1d9"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="13"
    font-weight="600"
  >
    ${totalContributions} contribuições no último ano
  </text>

  <g>
    ${squares.join("\n")}
  </g>

  <path
    class="route-guide"
    d="${routePath}"
    fill="none"
    stroke="#ff3333"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  />

  <path
    class="snake"
    d="${routePath}"
    pathLength="1000"
    fill="none"
    stroke="#ff3333"
    stroke-width="7"
    stroke-linecap="round"
    stroke-linejoin="round"
    stroke-dasharray="55 945"
    stroke-dashoffset="0"
  >
    <animate
      attributeName="stroke-dashoffset"
      from="0"
      to="-1000"
      dur="14s"
      repeatCount="indefinite"
    />
  </path>
</svg>
`.trim();

await mkdir("dist", {
  recursive: true
});

await writeFile(
  "dist/github-contribution-grid-snake.svg",
  svg,
  "utf8"
);

console.log(
  `Animação gerada com ${totalContributions} contribuições.`
);
