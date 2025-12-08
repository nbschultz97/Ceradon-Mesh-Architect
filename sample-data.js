const presetScenarios = [
  {
    id: "urban",
    label: "Urban city block demo",
    meshVersion: "0.2",
    environment: {
      terrain: "Urban",
      ewLevel: "Medium",
      primaryBand: "2.4",
      designRadiusMeters: 320,
      targetReliability: 85,
      center: { lat: 40.76078, lng: -111.89105, zoom: 17 }
    },
    nodes: [
      { id: "controller-1", label: "Gateway Rooftop", role: "controller", band: "2.4", maxRangeMeters: 420, lat: 40.76095, lng: -111.8919 },
      { id: "relay-1", label: "Relay West", role: "relay", band: "2.4", maxRangeMeters: 360, lat: 40.7605, lng: -111.8929 },
      { id: "relay-2", label: "Relay East", role: "relay", band: "2.4", maxRangeMeters: 360, lat: 40.76055, lng: -111.8899 },
      { id: "relay-3", label: "Relay North", role: "relay", band: "2.4", maxRangeMeters: 360, lat: 40.7617, lng: -111.8914 },
      { id: "sensor-1", label: "Door Sensor A", role: "sensor", band: "2.4", maxRangeMeters: 260, lat: 40.7612, lng: -111.8902 },
      { id: "sensor-2", label: "Door Sensor B", role: "sensor", band: "2.4", maxRangeMeters: 260, lat: 40.7613, lng: -111.8922 },
      { id: "client-1", label: "Patrol 1", role: "client", band: "2.4", maxRangeMeters: 180, lat: 40.7601, lng: -111.8908 },
      { id: "client-2", label: "Patrol 2", role: "client", band: "2.4", maxRangeMeters: 180, lat: 40.76005, lng: -111.8922 },
      { id: "client-3", label: "Lobby Tablet", role: "client", band: "2.4", maxRangeMeters: 180, lat: 40.76105, lng: -111.8911 }
    ]
  },
  {
    id: "rural",
    label: "Rural valley demo",
    meshVersion: "0.2",
    environment: {
      terrain: "Rural",
      ewLevel: "Low",
      primaryBand: "900",
      designRadiusMeters: 500,
      targetReliability: 80,
      center: { lat: 43.6135, lng: -111.096, zoom: 15 }
    },
    nodes: [
      { id: "controller-1", label: "Hilltop Gateway", role: "controller", band: "900", maxRangeMeters: 500, lat: 43.6142, lng: -111.0972 },
      { id: "relay-1", label: "Valley Relay", role: "relay", band: "900", maxRangeMeters: 420, lat: 43.6121, lng: -111.0954 },
      { id: "relay-2", label: "Farm Relay", role: "relay", band: "900", maxRangeMeters: 420, lat: 43.6115, lng: -111.0985 },
      { id: "sensor-1", label: "Barn Sensor", role: "sensor", band: "900", maxRangeMeters: 260, lat: 43.6126, lng: -111.0991 },
      { id: "sensor-2", label: "Irrigation Sensor", role: "sensor", band: "900", maxRangeMeters: 260, lat: 43.6135, lng: -111.094 },
      { id: "client-1", label: "Rover", role: "client", band: "900", maxRangeMeters: 200, lat: 43.613, lng: -111.097 },
      { id: "client-2", label: "Perimeter Tech", role: "client", band: "900", maxRangeMeters: 200, lat: 43.6129, lng: -111.0932 }
    ]
  },
  {
    id: "fos",
    label: "Forward operating site demo",
    meshVersion: "0.2",
    environment: {
      terrain: "Suburban",
      ewLevel: "High",
      primaryBand: "1.2",
      designRadiusMeters: 450,
      targetReliability: 85,
      center: { lat: 29.427, lng: -98.4918, zoom: 16 }
    },
    nodes: [
      { id: "controller-1", label: "TOC Gateway", role: "controller", band: "1.2", maxRangeMeters: 520, lat: 29.4268, lng: -98.4915 },
      { id: "relay-1", label: "North Perimeter", role: "relay", band: "1.2", maxRangeMeters: 430, lat: 29.4279, lng: -98.4914 },
      { id: "relay-2", label: "South Perimeter", role: "relay", band: "1.2", maxRangeMeters: 430, lat: 29.4259, lng: -98.4919 },
      { id: "uxs-1", label: "Overwatch UxS", role: "uxs", band: "1.2", maxRangeMeters: 650, lat: 29.4271, lng: -98.4895, altitudeMeters: 120 },
      { id: "client-1", label: "Gate Team", role: "client", band: "1.2", maxRangeMeters: 200, lat: 29.4267, lng: -98.4901 },
      { id: "client-2", label: "Tower Observer", role: "client", band: "1.2", maxRangeMeters: 200, lat: 29.4275, lng: -98.4928 },
      { id: "sensor-1", label: "Sensor East", role: "sensor", band: "1.2", maxRangeMeters: 260, lat: 29.4272, lng: -98.4937 },
      { id: "sensor-2", label: "Sensor West", role: "sensor", band: "1.2", maxRangeMeters: 260, lat: 29.4262, lng: -98.4896 }
    ]
  }
];
