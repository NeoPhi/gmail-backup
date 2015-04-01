var gulp = require('gulp');
var sourcemaps = require('gulp-sourcemaps');
var babel = require('gulp-babel');
var concat = require('gulp-concat');
var eslint = require('gulp-eslint');

gulp.task('lint', function () {
  return gulp.src(['js/**/*.js'])
    .pipe(eslint())
    .pipe(eslint.format())
    .pipe(eslint.failOnError());
});

gulp.task('default', ['lint'], function () {
  return gulp.src('src/**/*.js')
//    .pipe(sourcemaps.init())
//    .pipe(concat('all.js'))
    .pipe(babel())
//    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('dist'));
});
