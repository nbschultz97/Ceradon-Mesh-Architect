const demoScenario = {
  meshVersion: "0.1",
  environment: {
    terrain: "Urban",
    ewLevel: "Medium",
    primaryBand: "2.4",
    designRadiusMeters: 300,
    targetReliability: 80
  },
  nodes: [
    { id: "controller-1", label: "Gateway Alpha", role: "controller", band: "2.4", maxRangeMeters: 400 },
    { id: "relay-1", label: "Relay West", role: "relay", band: "2.4", maxRangeMeters: 350 },
    { id: "relay-2", label: "Relay East", role: "relay", band: "2.4", maxRangeMeters: 350 },
    { id: "relay-3", label: "Relay North", role: "relay", band: "2.4", maxRangeMeters: 350 },
    { id: "sensor-1", label: "Sensor 1", role: "sensor", band: "2.4", maxRangeMeters: 250 },
    { id: "sensor-2", label: "Sensor 2", role: "sensor", band: "2.4", maxRangeMeters: 250 },
    { id: "sensor-3", label: "Sensor 3", role: "sensor", band: "2.4", maxRangeMeters: 250 },
    { id: "sensor-4", label: "Sensor 4", role: "sensor", band: "2.4", maxRangeMeters: 250 },
    { id: "client-1", label: "Client A", role: "client", band: "2.4", maxRangeMeters: 150 },
    { id: "client-2", label: "Client B", role: "client", band: "2.4", maxRangeMeters: 150 },
    { id: "client-3", label: "Client C", role: "client", band: "2.4", maxRangeMeters: 150 }
  ]
};
