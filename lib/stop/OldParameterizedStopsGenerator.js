'use strict';

const fs = require('fs');
const csvparse = require('csv-parse');
const transform = require('stream-transform');

const StopsGenerator = require('./StopsGenerator.js');
const Point = require('../util/Point.js');
const TripsVisualizer = require('../visualize/TripsVisualizer.js');

class OldParameterizedStopsGenerator extends StopsGenerator {
    constructor(region_cells_filepath) {
        super();
        this.region_cells_filepath = region_cells_filepath;
        this.points = [];
        this.edges = [];
        this.region = new Region();

        this.param_seed = 1; // Random seed
        this.param_min_station_size = 0.01; // The minimum population density for a station to form
        this.param_routes = 100; // The number of routes to generate
        this.edges_per_route_average = 10; // The average number of edges per route
        this.edges_per_route_variation = 2; // The variation in number of edges per route;
        this.param_start_stop_choice_power = 4; // Higher values means higher chance on larger stations when selecting starting stations
        this.param_target_stop_in_radius_choice_power = 3; // Higher values means higher chance on larger stations when selecting target stations in a radius
        this.param_max_edge_distance_factor = 0.5; // The maximum distance of a edge divided by the maximum region diameter
        this.param_max_size_difference_factor = 0.5; // The maximum relative distance end stations can have
    }

    random() {
        var x = Math.sin(this.param_seed++) * 10000;
        return x - Math.floor(x);
    }

    prepareData() {
        var maxx = 0;
        var maxy = 0;
        var maxdistance = 0;
        var maxvalue = 0;

        var parser = csvparse({delimiter: ','});
        var input = fs.createReadStream(this.region_cells_filepath);
        var transformer = transform((record, callback) => {
            if (record[0] != 'x') {
                var point = new Point(parseInt(record[0]), parseInt(record[1]), parseFloat(record[4]));
                if (point.value > 0) point.value = Math.log(point.value + 1);
                this.region.put(point.x, point.y, point.value); // TODO: currently, size == popdensity
                if (point.value >= this.param_min_station_size) {
                    this.points.push(point);
                    maxx = Math.max(maxx, point.x);
                    maxy = Math.max(maxy, point.y);
                    maxvalue = Math.max(maxvalue, point.value);
                }
            }
            callback(null);
        }, () => {});

        input.pipe(parser).pipe(transformer).on('finish', () => {
            setImmediate(() => {
                this.points.sort(function(a, b) {
                    return b.value - a.value;
                });
                maxdistance = Math.max(maxx, maxy);
                this.generateStopsAndTrips(maxx, maxy, maxdistance, maxvalue);
            });
        });
    }

    getRandomElementWeightedBySize(elements, power) {
        // Choose a random value with a larger chance of having a lower index.
        var uniform = this.random();
        var beta = Math.pow(Math.sin(uniform * Math.PI / 2), power);
        var beta_left = (beta < 0.5) ? 2 * beta : 2 * (1 - beta);
        var randi = Math.floor(beta_left * elements.length);
        return elements[randi];
    }

    getRandomPointWeightedBySize() {
        return this.getRandomElementWeightedBySize(this.points, this.param_start_stop_choice_power);
    }

    generateStopsAndTrips(maxx, maxy, maxdistance, maxvalue) {
        // Loop X times
        // Pick a times a random start station
        // Loop requiredTrips times (to create a route containing edges
        // Based, on the size, define a radius
        // Within that radius, find X stations
        // Pick random station in that list, weighted by difference in size (exclude stations with a smaller size)
        // Create a trip between those stations
        // Set random station as start station
        // Loop next
        for (var i = 0; i < this.param_routes; i++) {
            var requiredTrips = Math.ceil(((this.random() - 0.5) * this.edges_per_route_variation * 2) + this.edges_per_route_average);
            var point = this.getRandomPointWeightedBySize();
            while (point.value < this.param_min_station_size) {
                point = this.getRandomPointWeightedBySize();
            }
            var firstPoint = true;
            var offsetX = 0;
            var offsetY = 0;
            for (var j = 0; j < requiredTrips; j++) {
                var radius = point.value / maxvalue * maxdistance * this.param_max_edge_distance_factor * (firstPoint ? 1 : 0.5);
                var points = this.region.getPointsInRegion(point.x + offsetX, point.y + offsetY, Math.ceil(radius), point.value * this.param_max_size_difference_factor);
                points.sort(function (a, b) {
                    return (point.value - Math.abs(a.value - b.value));
                });
                var targetPoint = this.getRandomElementWeightedBySize(points, this.param_target_stop_in_radius_choice_power);

                if (targetPoint) {
                    this.region.markStation(point.x, point.y);
                    this.region.markStation(targetPoint.x, targetPoint.y);
                    this.edges.push({from: point, to: targetPoint});

                    // Choose a new point in the direction of the targetPoint
                    // Because in the non-first iteration, the radius will be halved,
                    // which will lead to more straight routes.
                    offsetX = Math.ceil((targetPoint.x - point.x) / 2);
                    offsetY = Math.ceil((targetPoint.y - point.y) / 2);
                    point = targetPoint;
                    firstPoint = false;
                } else {
                    j = requiredTrips;
                }
            }
        }

        // Merge similar edges/routes
        // TODO


        // Additional step to make sure ALL stops can be reached
        // Form clusters (each of them has 1 largest station)
        // While #clusters > 1
        //   Pick 1 random clusters
        //   Find closest cluster based on largest stations
        //   Determine largest point in each cluster, connect them with a trip, merge clusters
        // TODO

        var visualizer = new TripsVisualizer(this.region, this.edges).render("edges.png");
    }

    generate() {
        this.prepareData();
    }

    getPoints() {
        return this.points;
    }
}

module.exports = OldParameterizedStopsGenerator;